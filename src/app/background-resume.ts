/**
 * pi-subagents: a resumed background run.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { footerProgress } from "../telemetry/progress.ts";
import { trackSession } from "../telemetry/track.ts";
import { abandonedNote, installRunBudget } from "./guards/install.ts";
import { activeModelId, snapshotHistory, sumUsage } from "../domain/run-result.ts";
import { annotateFailure, awaitWithHardStop, surfaceBudgetNotes } from "./guards/stop.ts";
import { runReport } from "../domain/run-report.ts";
import { startSubagentSession } from "../infra/host-session.ts";
import { windDownSignal } from "./guards/wind.ts";
import { applyReportBudget, effectiveBudget } from "../domain/subagent/budget.ts";
import { MAX_LIVE_TASKS, newTaskId } from "./task-record.ts";
import { liveStop } from "./live-runs.ts";
import { removedIds, unknownTaskMessage } from "./removed-ids.ts";
import { isRunStopped, RunStopped, stoppedRowNote } from "../domain/run-stop.ts";
import { applyRunOverrides } from "../domain/tiers.ts";
import type { RunOverrides } from "../domain/tiers.ts";
import { readGlobalConfig, withGlobalConfig } from "./global-config.ts";
import { ledger, markKind } from "./ledger.ts";
import type { TaskRecord } from "./task-record.ts";
import type { TaskStore } from "./task-store.ts";

export async function resumeTask(
	store: TaskStore,
	taskId: string,
	subagentName: string,
	prompt: string,
	ctx: ExtensionContext,
	overrides: RunOverrides = {},
): Promise<{ taskId: string; resumed: true } | { error: string }> {
	const rec = store.get(taskId);
	if (!rec) return { error: unknownTaskMessage(taskId) };
	if (rec.status === "running")
		return { error: `Task "${taskId}" is still running. Poll it with TaskOutput first.` };
	if (rec.subagentName !== subagentName) {
		return {
			error: `Resume keeps the same subagent ("${rec.subagentName}"). Start a new task to switch subagents.`,
		};
	}
	if (!store.canStart()) {
		return {
			error: `Too many live tasks (max ${MAX_LIVE_TASKS}). Poll or wait for one to finish first.`,
		};
	}

	const followId = newTaskId();
	const sub = applyRunOverrides(
		withGlobalConfig(rec.subagent, readGlobalConfig(ctx.cwd)),
		overrides,
	);
	const follow: TaskRecord = {
		taskId: followId,
		subagentName: rec.subagentName,
		description: `resume of ${taskId}`,
		status: "running",
		createdAt: Date.now(),
		fullDelivered: false,
		subagent: sub,
		cwd: rec.cwd,
		history: [],
		kind: "background",
	};
	store.add(follow);
	ledger.begin(rec.subagentName);
	markKind(rec.subagentName, "background");

	void (async () => {
		try {
			const child = await startSubagentSession(sub, rec.cwd, ctx);
			const stop = trackSession(
				child.session,
				followId,
				`${sub.name} ${followId.replace(/[^a-z0-9]/gi, "").slice(-4)}`,
				{ journalId: followId, kind: "resume" },
			);
			const live = liveStop(followId, sub.name, child.session, (why) => {
				store.remove(followId);
				removedIds.add(followId);
				ledger.finish(sub.name, "stopped");
				stop({ status: "interrupted", error: stoppedRowNote(why) });
			});
			const budgetStop = installRunBudget(child.session, effectiveBudget(sub.budget));
			budgetStop.windDown((secsLeft) => {
				void windDownSignal(child.session, child.notes, secsLeft);
			});
			try {
				const prior =
					rec.history.length > 0 ? JSON.stringify(rec.history).slice(0, 20000) : "(no prior turns)";
				const outcome = await awaitWithHardStop(
					child.session,
					child.session.prompt(
						`Prior context (kept history, may be cut): ${prior}\n\nFollow-up task: ${prompt}`,
					),
					budgetStop,
				);
				if (live.wasStopped()) throw new RunStopped(live.why());
				if (outcome === "abandoned") child.notes.push(abandonedNote());
				follow.history = snapshotHistory(child.session);
				const stopNote = surfaceBudgetNotes(child.notes, budgetStop);
				const text = runReport(child.session, { stopNote, steps: footerProgress.recent(followId) });
				follow.result = {
					text: applyReportBudget(text, sub.budget),
					usage: sumUsage(child.session.messages),
					model: activeModelId(child.session),
					notes: child.notes,
				};
				follow.status = "done";
				store.touch();
				ledger.finish(rec.subagentName, "done");
				stop({
					status: "done",
					reportChars: follow.result.text.length,
					model: follow.result.model,
					notes: follow.result.notes,
				});
			} catch (err) {
				if (live.wasStopped()) throw new RunStopped(live.why());
				const why = annotateFailure(err, surfaceBudgetNotes(child.notes, budgetStop));
				follow.history = snapshotHistory(child.session);
				store.touch();
				stop({ status: "error", error: why instanceof Error ? why.message : String(why) });
				throw why;
			} finally {
				budgetStop.dispose();
				live.unregister();
				stop();
				child.session.dispose();
			}
		} catch (err) {
			if (isRunStopped(err)) return;
			const message = err instanceof Error ? err.message : String(err);
			ledger.finish(rec.subagentName, "error");
			follow.status = "error";
			follow.error = message;
			store.touch();
		}
	})();

	return { taskId: followId, resumed: true };
}
