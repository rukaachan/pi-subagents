/**
 * pi-subagents: sequential chains.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SubagentConfig } from "../domain/subagent/config.ts";
import { trackSession } from "../telemetry/track.ts";
import { activeModelId, lastText, snapshotHistory, sumUsage } from "../domain/run-result.ts";
import { startSubagentSession } from "../infra/host-session.ts";
import { ledger, markKind } from "./ledger.ts";
import { newTaskId } from "./task-record.ts";
import type { ChainStep, TaskRecord } from "./task-record.ts";
import { TaskStore } from "./task-store.ts";
import type { SubagentRunResult } from "../domain/run-result.ts";
import { liveStop, type LiveStop } from "./live-runs.ts";
import { removedIds } from "./removed-ids.ts";
import { RunStopped } from "../domain/run-stop.ts";

export interface ChainSpec {
	steps: string[];
	prompt: string;
}

/** What a chain step passes on; longer reports are cut. */
export const MAX_PRIOR_REPORT = 8000;

export function stepPrompt(spec: ChainSpec, idx: number, priorReport?: string): string {
	if (idx === 0) return spec.prompt;
	const prior = priorReport ? priorReport.slice(0, MAX_PRIOR_REPORT) : "(no prior report)";
	return `Prior step report (may be cut):\n${prior}\n\nOriginal task: ${spec.prompt}\n\nContinue from the report above. Do your own step and return one short report.`;
}

export function newChainSteps(spec: ChainSpec): ChainStep[] {
	return spec.steps.map((name, idx) => ({
		idx,
		subagentName: name,
		prompt: stepPrompt(spec, idx),
		status: idx === 0 ? "running" : "pending",
	}));
}

export interface ChainRun {
	taskId: string;
	done: Promise<void>;
}

export function runChain(
	store: TaskStore,
	spec: ChainSpec,
	subagents: SubagentConfig[],
	cwd: string,
	ctx: ExtensionContext,
	description: string,
	_kind: "foreground" | "background" = "background",
	attachSignal?: AbortSignal,
): ChainRun | { error: string } {
	const taskId = newTaskId();
	const lead = subagents[0];
	if (!lead) return { error: "Chain has no subagents." };
	const rec: TaskRecord = {
		taskId,
		subagentName: spec.steps[0] ?? "chain",
		description,
		status: "running",
		createdAt: Date.now(),
		fullDelivered: false,
		subagent: lead,
		cwd,
		history: [],
		kind: "chain",
		steps: newChainSteps(spec),
	};
	store.add(rec);
	ledger.begin(spec.steps[0] ?? "chain");
	markKind(spec.steps[0] ?? "chain", "chain");

	const done = (async () => {
		let priorReport: string | undefined;
		const seen: SubagentRunResult[] = [];
		try {
			for (const step of rec.steps ?? []) {
				if (attachSignal?.aborted) throw new Error("aborted");
				const sub = subagents[step.idx];
				if (!sub) throw new Error(`Chain step ${step.idx + 1} has no subagent.`);
				step.status = "running";
				step.startedAt = Date.now();
				step.prompt = stepPrompt(spec, step.idx, priorReport);
				store.touch();
				const child = await startSubagentSession(sub, cwd, ctx);
				const runId = `${taskId}-${step.idx}`;
				const stepLabel = `${sub.name} ${step.idx + 1}/${rec.steps?.length ?? "?"}`;
				const stop = trackSession(child.session, runId, stepLabel, {
					journalId: runId,
					kind: "chain",
				});
				const live: LiveStop = liveStop(
					runId,
					`${sub.name} ${step.idx + 1}`,
					child.session,
					(why) => {
						stop({ status: "interrupted", error: `interrupted by ${why}` });
					},
				);
				try {
					const onAbort = () => child.session.abort();
					attachSignal?.addEventListener("abort", onAbort, { once: true });
					try {
						await child.session.prompt(step.prompt);
					} finally {
						attachSignal?.removeEventListener("abort", onAbort);
					}
					if (live.wasStopped()) throw new RunStopped(live.why());
					const text = lastText(child.session);
					step.report = text;
					step.status = "done";
					step.endedAt = Date.now();
					priorReport = text;
					seen.push({
						text,
						usage: sumUsage(child.session.messages),
						model: activeModelId(child.session),
						notes: [...child.notes],
					});
					rec.history = snapshotHistory(child.session);
					rec.result = aggregateResult(seen, rec);
					store.touch();
					stop({
						status: "done",
						reportChars: text.length,
						model: activeModelId(child.session),
						notes: [...child.notes],
					});
				} catch (err) {
					if (live.wasStopped()) {
						live.unregister();
						throw new RunStopped(live.why());
					}
					stop({ status: "error", error: err instanceof Error ? err.message : String(err) });
					throw err;
				} finally {
					live.unregister();
					stop();
					child.session.dispose();
				}
			}
			rec.status = "done";
			rec.result = aggregateResult(seen, rec);
			ledger.finish(rec.subagentName, "done");
		} catch (err) {
			if (err instanceof RunStopped) {
				store.remove(taskId);
				removedIds.add(taskId);
				ledger.finish(rec.subagentName, "stopped");
				store.touch();
				throw err;
			}
			const message = err instanceof Error ? err.message : String(err);
			const failing = rec.steps?.find((s) => s.status === "running");
			if (failing) {
				failing.status = "error";
				failing.error = message;
				failing.endedAt = Date.now();
			}
			rec.status = "error";
			rec.error = message;
			ledger.finish(rec.subagentName, "error");
		} finally {
			store.touch();
		}
	})();

	return { taskId, done };
}

export function aggregateResult(steps: SubagentRunResult[], rec: TaskRecord): SubagentRunResult {
	const usage = steps.reduce<SubagentRunResult["usage"]>(
		(acc, s) => ({
			input: acc.input + s.usage.input,
			output: acc.output + s.usage.output,
			cacheRead: acc.cacheRead + s.usage.cacheRead,
			cacheWrite: acc.cacheWrite + s.usage.cacheWrite,
			cost: acc.cost + s.usage.cost,
			turns: acc.turns + s.usage.turns,
		}),
		{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
	);
	const notes = steps.flatMap((s) => s.notes);
	const model = steps[steps.length - 1]?.model;
	const sections = (rec.steps ?? [])
		.filter((s) => s.status === "done" && s.report)
		.map((s) => `### ${s.idx + 1}. ${s.subagentName}\n${s.report}`);
	return {
		text: sections.join("\n\n") || "(chain produced no report)",
		usage,
		model,
		notes,
	};
}
