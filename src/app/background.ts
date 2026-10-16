/**
 * pi-subagents: background driver.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SubagentConfig } from "../domain/subagent/config.ts";
import { footerProgress } from "../telemetry/progress.ts";
import { trackSession } from "../telemetry/track.ts";
import { abandonedNote, installRunBudget } from "./guards/install.ts";
import { activeModelId, snapshotHistory, sumUsage } from "../domain/run-result.ts";
import { annotateFailure, awaitWithHardStop, surfaceBudgetNotes } from "./guards/stop.ts";
import { runReport } from "../domain/run-report.ts";
import { startSubagentSession } from "../infra/host-session.ts";
import { windDownSignal } from "./guards/wind.ts";
import { applyReportBudget, effectiveBudget } from "../domain/subagent/budget.ts";
import { newTaskId } from "./task-record.ts";
import { liveStop } from "./live-runs.ts";
import { removedIds } from "./removed-ids.ts";
import { isRunStopped, RunStopped, stoppedRowNote } from "../domain/run-stop.ts";
import { ledger, markKind } from "./ledger.ts";
import type { RunKind, TaskRecord } from "./task-record.ts";
import type { TaskStore } from "./task-store.ts";

export { resumeTask } from "./background-resume.ts";

export async function launchBackground(
	store: TaskStore,
	sub: SubagentConfig,
	description: string,
	prompt: string,
	cwd: string,
	ctx: ExtensionContext,
	opts?: {
		kind?: Extract<RunKind, "background" | "parallel">;
		dispatch?: { rule: string; matched: string };
	},
): Promise<string> {
	const kind = opts?.kind ?? "background";
	const taskId = newTaskId();
	const rec: TaskRecord = {
		taskId,
		subagentName: sub.name,
		description,
		status: "running",
		createdAt: Date.now(),
		fullDelivered: false,
		subagent: sub,
		cwd,
		history: [],
		kind,
		dispatch: opts?.dispatch,
	};
	store.add(rec);
	ledger.begin(sub.name);
	markKind(sub.name, kind);

	const early = liveStop(taskId, sub.name, { abort() {}, dispose() {} }, () => {
		store.remove(taskId);
		removedIds.add(taskId);
	});

	void (async () => {
		try {
			const child = await startSubagentSession(sub, cwd, ctx);
			const stop = trackSession(
				child.session,
				taskId,
				`${sub.name} ${taskId.replace(/[^a-z0-9]/gi, "").slice(-4)}`,
				{ journalId: taskId, kind },
			);
			// A stop request kills this run instead of finishing it: the row
			// leaves the board, the ledger books a stop, and the journal says
			// `interrupted`. Booked before the abort so the trail survives.
			const live = liveStop(taskId, sub.name, child.session, (why) => {
				store.remove(taskId);
				removedIds.add(taskId);
				ledger.finish(sub.name, "stopped");
				stop({ status: "interrupted", error: stoppedRowNote(why) });
			});
			if (early.wasStopped()) {
				live.stop(early.why());
				live.unregister();
				return;
			}
			// After trackSession: a throw there must not leave a timer
			// armed on a live session that the finally never sees.
			const budgetStop = installRunBudget(child.session, effectiveBudget(sub.budget));
			budgetStop.windDown((secsLeft) => {
				void windDownSignal(child.session, child.notes, secsLeft);
			});
			try {
				const outcome = await awaitWithHardStop(
					child.session,
					child.session.prompt(`Task: ${prompt}`),
					budgetStop,
				);
				// A disposed session may resolve instead of rejecting: the
				// stop is already booked, so the success path must not book
				// a second time.
				if (live.wasStopped()) throw new RunStopped(live.why());
				if (outcome === "abandoned") child.notes.push(abandonedNote());
				rec.history = snapshotHistory(child.session);
				const stopNote = surfaceBudgetNotes(child.notes, budgetStop);
				// A stopped run must not answer "(no output)": keep what it
				// said and the steps it took, so the caller can resume.
				const text = runReport(child.session, { stopNote, steps: footerProgress.recent(taskId) });
				rec.result = {
					text: applyReportBudget(text, sub.budget),
					usage: sumUsage(child.session.messages),
					model: activeModelId(child.session),
					notes: child.notes,
				};
				rec.status = "done";
				store.touch();
				ledger.finish(sub.name, "done");
				stop({
					status: "done",
					reportChars: rec.result.text.length,
					model: rec.result.model,
					notes: rec.result.notes,
				});
			} catch (err) {
				if (live.wasStopped()) throw new RunStopped(live.why());
				const why = annotateFailure(err, surfaceBudgetNotes(child.notes, budgetStop));
				rec.history = snapshotHistory(child.session);
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
			ledger.finish(sub.name, "error");
			rec.status = "error";
			rec.error = message;
			rec.fullDelivered = false;
			store.touch();
		}
	})();

	return taskId;
}
