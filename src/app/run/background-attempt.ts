/**
 * pi-subagents: one attempt at a background run.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SubagentConfig } from "../../domain/subagent/index.ts";
import { footerProgress } from "../../telemetry/live/index.ts";
import { trackSession } from "../../telemetry/live/index.ts";
import { abandonedNote, installRunBudget } from "../guards/index.ts";
import {
	activeModelId,
	isTransientFailure,
	providerFailure,
	snapshotHistory,
	sumUsage,
} from "../../domain/run/index.ts";
import { annotateFailure, awaitWithHardStop, surfaceBudgetNotes } from "../guards/index.ts";
import { runReport } from "../../domain/run/index.ts";
import { checkReturn } from "../../domain/run/index.ts";
import { journalWrite } from "../../telemetry/journal/index.ts";
import type { ChildSessionPort } from "./child-port.ts";
import { withGateJournal } from "../guards/index.ts";
import { teamChildExtras } from "../team/child/index.ts";
import { sweepMemberTasks } from "../team/board/index.ts";
import { bindTeamMember } from "../team/channel/index.ts";
import { windDownSignal } from "../guards/index.ts";
import { applyReportBudget, effectiveBudget } from "../../domain/subagent/index.ts";
import { registerLiveSession } from "../live/index.ts";
import { isRunStopped, RunStopped, stoppedRowNote } from "../../domain/task/index.ts";
import type { LiveStop, StoppableSession } from "../live/index.ts";
import { dropSteers, takeSteers } from "../live/index.ts";
import type { TaskStorePort } from "../../domain/task/index.ts";
import type { RunKind, TaskRecord } from "../../domain/task/index.ts";

export interface AttemptResult {
	ok: boolean;
	error?: string;
	transient?: boolean;
	stopped?: boolean;
}

export interface AttemptDeps {
	rec: TaskRecord;
	sub: SubagentConfig;
	prompt: string;
	cwd: string;
	ctx: ExtensionContext;
	child: ChildSessionPort;
	store: TaskStorePort;
	kind: RunKind;
	contract?: readonly string[];
	live: LiveStop;
	holder: StoppableSession;
	setStopHandle: (fn: ((why: string) => void) | null) => void;
}

/** Run one child session. Never books the ledger; the caller owns that. */
export async function runBackgroundAttempt(deps: AttemptDeps): Promise<AttemptResult> {
	const { rec, sub, prompt, cwd, ctx, kind, contract, live, holder, setStopHandle } = deps;
	const gate = { open: true };
	const team = teamChildExtras(sub.name, rec.taskId, gate);
	const child = await deps.child.create(sub, cwd, ctx, withGateJournal(team));
	const unbindMail = team
		? bindTeamMember(
				team.member,
				sub.name,
				(text) => {
					void child.session.steer(text).catch(() => {});
				},
				rec.taskId,
			)
		: () => {};
	rec.startedAt = Date.now();
	deps.store.touch();
	holder.abort = () => {
		rec.history = snapshotHistory(child.session);
		child.session.abort();
	};
	holder.dispose = () => child.session.dispose();
	const stop = trackSession(
		child.session,
		rec.taskId,
		`${sub.name} ${rec.taskId.replace(/[^a-z0-9]/gi, "").slice(-4)}`,
		{
			journalId: rec.taskId,
			kind,
			hook: sub.finishHook,
			subagent: sub.name,
			cwd,
			...(rec.runId ? { runId: rec.runId } : {}),
		},
	);
	setStopHandle((why) => {
		gate.open = false;
		stop({ status: "interrupted", error: stoppedRowNote(why) });
	});
	const budgetStop = installRunBudget(child.session, effectiveBudget(sub.budget));
	budgetStop.windDown((secsLeft) => {
		void windDownSignal(child.session, child.notes, secsLeft);
	});
	const unregisterView = registerLiveSession(rec.taskId, {
		messages: () => child.session.messages,
		streaming: () => child.session.agent.state.streamingMessage,
		subscribe: (fn) => child.session.subscribe((event) => fn(event.type)),
		steer: async (text) => {
			try {
				await child.session.steer(text);
				return true;
			} catch {
				return false;
			}
		},
	});
	try {
		if (live.wasStopped()) {
			stop({ status: "interrupted", error: stoppedRowNote(live.why()) });
			return { ok: false, stopped: true };
		}
		const turn = child.prompt(`Task: ${prompt}`, contract);
		// A steer can arrive before this session exists; it lands here.
		for (const text of takeSteers(rec.taskId)) {
			void child.session.steer(text).catch(() => {});
		}
		const outcome = await awaitWithHardStop(child.session, turn, budgetStop);
		if (live.wasStopped()) throw new RunStopped(live.why());
		const failure = providerFailure(child.session);
		if (failure) throw new Error(failure);
		if (outcome === "abandoned") child.notes.push(abandonedNote());
		rec.history = snapshotHistory(child.session);
		const stopNote = surfaceBudgetNotes(child.notes, budgetStop);
		const text = applyReportBudget(
			runReport(child.session, { stopNote, steps: footerProgress.recent(rec.taskId) }),
			sub.budget,
		);
		const checked = checkReturn(text, contract ?? []);
		rec.result = {
			text: checked.text,
			usage: sumUsage(child.session.messages),
			model: activeModelId(child.session),
			notes: child.notes,
			...(checked.missing.length > 0 ? { missing: checked.missing } : {}),
		};
		rec.status = "done";
		rec.endedAt = Date.now();
		if (checked.failure && !rec.failure) {
			rec.failure = checked.failure;
			journalWrite({ event: "failure", id: rec.taskId, family: checked.failure, auto: true });
		}
		stop({
			status: "done",
			reportChars: rec.result.text.length,
			model: rec.result.model,
			notes: rec.result.notes,
		});
		return { ok: true };
	} catch (err) {
		gate.open = false;
		if (isRunStopped(err)) return { ok: false, stopped: true };
		const why = annotateFailure(err, surfaceBudgetNotes(child.notes, budgetStop));
		const message = why instanceof Error ? why.message : String(why);
		rec.history = snapshotHistory(child.session);
		rec.endedAt = Date.now();
		stop({ status: "error", error: message });
		return { ok: false, error: message, transient: isTransientFailure(message) };
	} finally {
		gate.open = false;
		unbindMail();
		dropSteers(rec.taskId);
		setStopHandle(null);
		budgetStop.dispose();
		unregisterView();
		stop();
		rec.history = snapshotHistory(child.session);
		child.session.dispose();
		if (live.wasStopped()) sweepMemberTasks(rec.taskId, false, Date.now(), "stopped");
		holder.abort = () => {};
		holder.dispose = () => {};
	}
}
