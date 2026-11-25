/**
 * pi-subagents: a resumed background run.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { footerProgress } from "../../telemetry/live/index.ts";
import { trackSession } from "../../telemetry/live/index.ts";
import { abandonedNote, installRunBudget } from "../guards/index.ts";
import {
	activeModelId,
	providerFailure,
	snapshotHistory,
	sumUsage,
	usageEnd,
} from "../../domain/run/index.ts";
import { annotateFailure, awaitWithHardStop, surfaceBudgetNotes } from "../guards/index.ts";
import { runReport } from "../../domain/run/index.ts";
import { checkReturn } from "../../domain/run/index.ts";
import { resumePrompt } from "../retry/index.ts";
import type { ChildDeps } from "./child-port.ts";
import { withGateJournal } from "../guards/index.ts";
import { agentTeamChildExtras } from "../agent-team/child/index.ts";
import { bindAgentTeamMember } from "../agent-team/channel/index.ts";
import { getTask, sweepMemberTasks } from "../agent-team/board/index.ts";
import { requestAgentTeamVerify } from "../agent-team/verify/index.ts";
import { completeTask, ensureTask, taskPrompt } from "../agent-team/auto/index.ts";
import { windDownSignal } from "../guards/index.ts";
import { applyReportBudget, effectiveBudget } from "../../domain/subagent/index.ts";
import { MAX_LIVE_TASKS, newTaskId } from "../../domain/task/index.ts";
import { liveStop } from "../live/index.ts";
import { registerLiveSession } from "../live/index.ts";
import { unknownTaskMessage } from "../stop/index.ts";
import { markStopped } from "../stop/index.ts";
import { isRunStopped, RunStopped, stoppedRowNote } from "../../domain/task/index.ts";
import { applyRunOverrides } from "../../domain/run/index.ts";
import type { RunOverrides } from "../../domain/run/index.ts";
import { readGlobalConfig, withGlobalConfig } from "../session/index.ts";
import { ledger, markKind } from "../session/index.ts";
import type { TaskStorePort } from "../../domain/task/index.ts";
import { announceSettle } from "../live/index.ts";
import { archivedTask } from "../session/index.ts";
import { resumeRecord } from "./resume-row.ts";

export async function resumeTask(
	store: TaskStorePort,
	taskId: string,
	subagentName: string,
	prompt: string,
	ctx: ExtensionContext,
	deps: ChildDeps,
	overrides: RunOverrides = {},
	contract: readonly string[] = [],
): Promise<{ taskId: string; resumed: true } | { error: string }> {
	const liveRow = store.get(taskId);
	// A row from an older session still resumes by explicit id after a restart.
	const rec = liveRow ?? archivedTask(ctx.cwd, taskId);
	if (!rec) return { error: unknownTaskMessage(taskId) };
	if (rec.status === "running")
		return { error: `Task "${taskId}" is still running. Poll it with TaskOutput first.` };
	if (rec.subagentName !== subagentName) {
		return {
			error: `Resume keeps the same subagent ("${rec.subagentName}"). Start a new task to switch subagents.`,
		};
	}
	const global = readGlobalConfig(ctx.cwd, undefined, {
		trusted: ctx.isProjectTrusted?.() === true,
	});
	const cap = global.liveCap ?? MAX_LIVE_TASKS;
	if (!store.canStart(cap)) {
		return {
			error: `Too many live tasks (max ${cap}). Poll or wait for one to finish first.`,
		};
	}

	const parentSessionId = ctx.sessionManager.getSessionId();
	const followId = newTaskId();
	const sub = applyRunOverrides(withGlobalConfig(rec.subagent, global), overrides);
	const follow = resumeRecord({ rec, followId, sub, prompt, sessionId: parentSessionId });
	store.add(follow);
	ledger.begin(rec.subagentName);
	markKind(rec.subagentName, "background");

	void (async () => {
		try {
			const gate = { open: true };
			const role = rec.agentTeamRole ?? "worker";
			const agentTeam = agentTeamChildExtras(sub.name, rec.taskId, gate, role);
			let teamTaskId = rec.agentTeamTaskId;
			if (agentTeam && role === "worker") {
				const ensured = ensureTask({
					sub,
					prompt,
					origin: rec.agentTeamOrigin ?? "task",
					runId: followId,
					existingTaskId: teamTaskId,
					member: agentTeam.member,
				});
				if (!ensured.ok) throw new Error(ensured.error);
				teamTaskId = ensured.taskId;
				follow.agentTeamTaskId = teamTaskId;
			}
			const teamPrefix = teamTaskId
				? `${taskPrompt(teamTaskId, role)}\n\n`
				: role === "advisor"
					? `${taskPrompt("", role)}\n\n`
					: "";
			const child = await deps.child.create(sub, rec.cwd, ctx, withGateJournal(agentTeam));
			const unbindMail = agentTeam
				? bindAgentTeamMember(
						agentTeam.member,
						sub.name,
						(text) => {
							void child.session.steer(text).catch(() => {});
						},
						followId,
					)
				: () => {};
			const stop = trackSession(
				child.session,
				followId,
				`${sub.name} ${followId.replace(/[^a-z0-9]/gi, "").slice(-4)}`,
				{
					journalId: followId,
					kind: "resume",
					hook: sub.finishHook,
					subagent: sub.name,
					cwd: rec.cwd,
					...(rec.runId ? { runId: rec.runId } : {}),
				},
			);
			const live = liveStop(followId, sub.name, child.session, (why) => {
				gate.open = false;
				follow.history = snapshotHistory(child.session);
				markStopped(follow, why);
				store.touch();
				ledger.finish(sub.name, "stopped");
				sweepMemberTasks(rec.taskId, false, Date.now(), "stopped");
				stop({ status: "interrupted", error: stoppedRowNote(why) });
			});
			const budgetStop = installRunBudget(child.session, effectiveBudget(sub.budget));
			budgetStop.windDown((secsLeft) => {
				void windDownSignal(child.session, child.notes, secsLeft);
			});
			const unregisterView = registerLiveSession(followId, {
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
				const outcome = await awaitWithHardStop(
					child.session,
					child.prompt(`${teamPrefix}${resumePrompt(rec.history, prompt)}`, contract),
					budgetStop,
				);
				if (live.wasStopped()) throw new RunStopped(live.why());
				const failure = providerFailure(child.session);
				if (failure) throw new Error(failure);
				if (outcome === "abandoned") child.notes.push(abandonedNote());
				follow.history = snapshotHistory(child.session);
				const stopNote = surfaceBudgetNotes(child.notes, budgetStop);
				const text = applyReportBudget(
					runReport(child.session, { stopNote, steps: footerProgress.recent(followId) }),
					sub.budget,
				);
				const checked = checkReturn(text, contract);
				follow.result = {
					text: checked.text,
					usage: sumUsage(child.session.messages),
					model: activeModelId(child.session),
					notes: child.notes,
					...(checked.missing.length > 0 ? { missing: checked.missing } : {}),
				};
				follow.status = "done";
				follow.endedAt = Date.now();
				if (teamTaskId && role === "worker") {
					completeTask(teamTaskId, follow.result.text);
					if (getTask(teamTaskId)?.task.status === "in_review")
						requestAgentTeamVerify(teamTaskId, ctx);
				}
				ledger.finish(rec.subagentName, "done");
				stop({
					status: "done",
					reportChars: follow.result.text.length,
					promptChars: prompt.length,
					...usageEnd(follow.result.usage),
					model: follow.result.model,
					notes: follow.result.notes,
				});
				announceSettle(follow, parentSessionId, rec.taskId);
				store.touch();
			} catch (err) {
				gate.open = false;
				if (live.wasStopped()) throw new RunStopped(live.why());
				const why = annotateFailure(err, surfaceBudgetNotes(child.notes, budgetStop));
				const message = why instanceof Error ? why.message : String(why);
				follow.history = snapshotHistory(child.session);
				store.touch();
				stop({
					status: "error",
					error: message,
					promptChars: prompt.length,
					...usageEnd(follow.result?.usage),
				});
				throw why;
			} finally {
				gate.open = false;
				unbindMail();
				budgetStop.dispose();
				unregisterView();
				live.unregister();
				stop();
				child.session.dispose();
				if (live.wasStopped()) sweepMemberTasks(rec.taskId, false, Date.now(), "stopped");
			}
		} catch (err) {
			if (isRunStopped(err)) return;
			const message = err instanceof Error ? err.message : String(err);
			ledger.finish(rec.subagentName, "error");
			follow.status = "error";
			follow.error = message;
			follow.endedAt = Date.now();
			announceSettle(follow, parentSessionId, rec.taskId);
			store.touch();
		}
	})();

	return { taskId: followId, resumed: true };
}
