/**
 * pi-subagents: one foreground run.
 */

import { trackSession } from "../telemetry/live/index.ts";
import { footerProgress, type ProgressSnapshot } from "../telemetry/live/index.ts";
import { ledger } from "./ledger.ts";
import type { SubagentRunResult } from "../domain/run/index.ts";
import { type TaskRecord } from "../domain/task/index.ts";
import { applyReportBudget, effectiveBudget } from "../domain/subagent/index.ts";
import { type SubagentConfig } from "../domain/subagent/index.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { abandonedNote, installRunBudget } from "./guards/install.ts";
import { annotateFailure, awaitWithHardStop, surfaceBudgetNotes } from "./guards/stop.ts";
import { windDownSignal } from "./guards/wind.ts";
import { runReport } from "../domain/run/index.ts";
import { checkReturn } from "../domain/run/index.ts";
import { journalWrite } from "../telemetry/journal/index.ts";
import {
	activeModelId,
	providerFailure,
	recordFailure,
	snapshotHistory,
	sumUsage,
} from "../domain/run/index.ts";
import { startSubagentSession } from "../infra/host/index.ts";
import { withGateJournal } from "./child-gate-journal.ts";
import { teamChildExtras } from "./team-child.ts";
import { bindTeamMember } from "./team-mail.ts";
import { sweepMemberTasks } from "./team-sweep.ts";
import { liveStop } from "./live-runs.ts";
import { RunStopped, stoppedRowNote } from "../domain/task/index.ts";

export function runProgress(key: string): ProgressSnapshot | undefined {
	return footerProgress.snapshot(key);
}

export async function runSubagent(
	sub: SubagentConfig,
	task: string,
	cwd: string,
	ctx: ExtensionContext,
	signal?: AbortSignal,
	runKey?: string,
	attach?: TaskRecord,
	contract: readonly string[] = [],
): Promise<SubagentRunResult> {
	ledger.begin(sub.name);
	const teamKey = attach?.taskId;
	const gate = { open: true };
	const team = teamChildExtras(sub.name, teamKey, gate);
	const child = await startSubagentSession(sub, cwd, ctx, withGateJournal(team));
	const unbindMail = team
		? bindTeamMember(
				team.member,
				sub.name,
				(text) => {
					void child.session.steer(text).catch(() => {});
				},
				teamKey,
			)
		: () => {};
	const trackKey = attach?.taskId ?? runKey;
	const stop = trackKey
		? trackSession(child.session, trackKey, sub.name, {
				journalId: trackKey,
				kind: "foreground",
				hook: sub.finishHook,
				subagent: sub.name,
				cwd,
			})
		: null;
	// One stop request reaches this run like any other: the row goes, the
	// ledger books a stop, and the journal says `interrupted`.
	const live = liveStop(trackKey ?? `${sub.name}-foreground`, sub.name, child.session, (why) => {
		gate.open = false;
		if (attach) attach.history = snapshotHistory(child.session);
		ledger.finish(sub.name, "stopped");
		sweepMemberTasks(teamKey, false, Date.now(), "stopped");
		stop?.({ status: "interrupted", error: stoppedRowNote(why) });
	});
	const budgetStop = installRunBudget(child.session, effectiveBudget(sub.budget));
	budgetStop.windDown((secsLeft) => {
		void windDownSignal(child.session, child.notes, secsLeft);
	});
	try {
		if (signal?.aborted) throw new Error("aborted");
		// The host abort must land as a stop: a disposed session can
		// resolve with no text, which would look like an empty success.
		const onAbort = () => live.stop("Esc");
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			const outcome = await awaitWithHardStop(
				child.session,
				child.prompt(`Task: ${task}`, contract),
				budgetStop,
			);
			// A disposed session may resolve instead of rejecting; the stop
			// is booked already, so this run must not report success too.
			if (live.wasStopped()) throw new RunStopped(live.why());
			const failure = providerFailure(child.session);
			if (failure) throw new Error(failure);
			if (outcome === "abandoned") child.notes.push(abandonedNote());
		} finally {
			signal?.removeEventListener("abort", onAbort);
		}
		const stopNote = surfaceBudgetNotes(child.notes, budgetStop);
		// A stopped run keeps its own words; when it never spoke, the
		// cut report stands in for the empty result.
		const text = applyReportBudget(
			runReport(child.session, {
				stopNote,
				steps: trackKey ? footerProgress.recent(trackKey) : [],
			}),
			sub.budget,
		);
		const checked = checkReturn(text, contract);
		const result: SubagentRunResult = {
			text: checked.text,
			usage: sumUsage(child.session.messages),
			model: activeModelId(child.session),
			notes: child.notes,
			...(checked.missing.length > 0 ? { missing: checked.missing } : {}),
		};
		stop?.({
			status: "done",
			reportChars: result.text.length,
			model: result.model,
			notes: result.notes,
		});
		if (attach) {
			attach.history = snapshotHistory(child.session);
			attach.result = result;
			attach.status = "done";
			if (checked.failure && !attach.failure) {
				attach.failure = checked.failure;
				journalWrite({
					event: "failure",
					id: attach.taskId,
					family: checked.failure,
					auto: true,
				});
			}
		}
		ledger.finish(sub.name, "done");
		return result;
	} catch (err) {
		gate.open = false;
		if (live.wasStopped()) throw new RunStopped(live.why());
		const why = annotateFailure(err, surfaceBudgetNotes(child.notes, budgetStop));
		const message = attach
			? recordFailure(attach, child.session, why)
			: why instanceof Error
				? why.message
				: String(why);
		ledger.finish(sub.name, "error");
		sweepMemberTasks(teamKey, false, Date.now(), message);
		stop?.({ status: "error", error: message });
		throw why;
	} finally {
		gate.open = false;
		unbindMail();
		budgetStop.dispose();
		live.unregister();
		stop?.();
		if (attach) attach.history = snapshotHistory(child.session);
		child.session.dispose();
		if (live.wasStopped()) sweepMemberTasks(teamKey, false, Date.now(), "stopped");
	}
}
