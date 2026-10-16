/**
 * pi-subagents: one foreground run.
 */

import { trackSession } from "../telemetry/track.ts";
import { footerProgress, type ProgressSnapshot } from "../telemetry/progress.ts";
import { ledger } from "./ledger.ts";
import type { SubagentRunResult } from "../domain/run-result.ts";
import { type TaskRecord } from "./task-record.ts";
import { applyReportBudget, effectiveBudget } from "../domain/subagent/budget.ts";
import { type SubagentConfig } from "../domain/subagent/config.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { abandonedNote, installRunBudget } from "./guards/install.ts";
import { annotateFailure, awaitWithHardStop, surfaceBudgetNotes } from "./guards/stop.ts";
import { windDownSignal } from "./guards/wind.ts";
import { runReport } from "../domain/run-report.ts";
import { activeModelId, recordFailure, snapshotHistory, sumUsage } from "../domain/run-result.ts";
import { startSubagentSession } from "../infra/host-session.ts";
import { liveStop } from "./live-runs.ts";
import { RunStopped, stoppedRowNote } from "../domain/run-stop.ts";

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
): Promise<SubagentRunResult> {
	ledger.begin(sub.name);
	const child = await startSubagentSession(sub, cwd, ctx);
	const trackKey = attach?.taskId ?? runKey;
	const stop = trackKey
		? trackSession(child.session, trackKey, sub.name, { journalId: trackKey, kind: "foreground" })
		: null;
	// One stop request reaches this run like any other: the row goes, the
	// ledger books a stop, and the journal says `interrupted`.
	const live = liveStop(trackKey ?? `${sub.name}-foreground`, sub.name, child.session, (why) => {
		ledger.finish(sub.name, "stopped");
		stop?.({ status: "interrupted", error: stoppedRowNote(why) });
	});
	const budgetStop = installRunBudget(child.session, effectiveBudget(sub.budget));
	budgetStop.windDown((secsLeft) => {
		void windDownSignal(child.session, child.notes, secsLeft);
	});
	try {
		if (signal?.aborted) throw new Error("aborted");
		const onAbort = () => child.session.abort();
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			const outcome = await awaitWithHardStop(
				child.session,
				child.session.prompt(`Task: ${task}`),
				budgetStop,
			);
			// A disposed session may resolve instead of rejecting; the stop
			// is booked already, so this run must not report success too.
			if (live.wasStopped()) throw new RunStopped(live.why());
			if (outcome === "abandoned") child.notes.push(abandonedNote());
		} finally {
			signal?.removeEventListener("abort", onAbort);
		}
		const stopNote = surfaceBudgetNotes(child.notes, budgetStop);
		// A stopped run keeps its own words; when it never spoke, the
		// cut report stands in for the empty result.
		const text = runReport(child.session, {
			stopNote,
			steps: trackKey ? footerProgress.recent(trackKey) : [],
		});
		const result: SubagentRunResult = {
			text: applyReportBudget(text, sub.budget),
			usage: sumUsage(child.session.messages),
			model: activeModelId(child.session),
			notes: child.notes,
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
		}
		ledger.finish(sub.name, "done");
		return result;
	} catch (err) {
		if (live.wasStopped()) throw new RunStopped(live.why());
		const why = annotateFailure(err, surfaceBudgetNotes(child.notes, budgetStop));
		const message = attach
			? recordFailure(attach, child.session, why)
			: why instanceof Error
				? why.message
				: String(why);
		ledger.finish(sub.name, "error");
		stop?.({ status: "error", error: message });
		throw why;
	} finally {
		budgetStop.dispose();
		live.unregister();
		stop?.();
		child.session.dispose();
	}
}
