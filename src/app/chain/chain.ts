/**
 * pi-subagents: sequential chains.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SubagentConfig } from "../../domain/subagent/index.ts";
import { trackSession } from "../../telemetry/live/index.ts";
import {
	activeModelId,
	lastText,
	providerFailure,
	snapshotHistory,
	sumUsage,
} from "../../domain/run/index.ts";
import { startSubagentSession } from "../../infra/host/index.ts";
import { withGateJournal } from "../guards/index.ts";
import { teamChildExtras } from "../team/channel/index.ts";
import { bindTeamMember } from "../team/channel/index.ts";
import { sweepMemberTasks } from "../team/board/index.ts";
import { ledger, markKind } from "../session/index.ts";
import { newTaskId } from "../../domain/task/index.ts";
import type { ChainStep, TaskRecord } from "../../domain/task/index.ts";
import { TaskStore } from "../../domain/task/index.ts";
import type { SubagentRunResult } from "../../domain/run/index.ts";
import { liveStop, type LiveStop, type StoppableSession } from "../live/index.ts";
import { markStopped } from "../stop/index.ts";
import { RunStopped } from "../../domain/task/index.ts";
import { aggregateResult } from "./chain-result.ts";

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
		startedAt: Date.now(),
		fullDelivered: false,
		subagent: lead,
		cwd,
		sessionId: ctx.sessionManager.getSessionId(),
		history: [],
		kind: "chain",
		runId: taskId,
		steps: newChainSteps(spec),
	};
	store.add(rec);
	ledger.begin(spec.steps[0] ?? "chain");
	markKind(spec.steps[0] ?? "chain", "chain");

	// The chain row needs its own handle: step handles are keyed by step id,
	// so a stop aimed at the chain would otherwise find no live child.
	const holder: StoppableSession = { abort() {}, dispose() {} };
	let stopCurrent: ((why: string) => void) | null = null;
	let chainStopWhy = "";
	const chainLive = liveStop(taskId, `chain ${spec.steps.length}`, holder, (why) => {
		chainStopWhy = why;
		stopCurrent?.(why);
	});

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
				const runId = `${taskId}-${step.idx}`;
				const gate = { open: true };
				const team = teamChildExtras(sub.name, runId, gate);
				const child = await startSubagentSession(sub, cwd, ctx, withGateJournal(team));
				const unbindMail = team
					? bindTeamMember(
							team.member,
							sub.name,
							(text) => {
								void child.session.steer(text).catch(() => {});
							},
							undefined,
							true,
						)
					: () => {};
				const stepLabel = `${sub.name} ${step.idx + 1}/${rec.steps?.length ?? "?"}`;
				const stop = trackSession(child.session, runId, stepLabel, {
					journalId: runId,
					kind: "chain",
					hook: sub.finishHook,
					subagent: sub.name,
					cwd,
					runId: taskId,
				});
				const live: LiveStop = liveStop(
					runId,
					`${sub.name} ${step.idx + 1}`,
					child.session,
					(why) => {
						gate.open = false;
						rec.history = snapshotHistory(child.session);
						stop({ status: "interrupted", error: `interrupted by ${why}` });
					},
				);
				holder.abort = () => child.session.abort();
				stopCurrent = (why) => {
					gate.open = false;
					stop({ status: "interrupted", error: `interrupted by ${why}` });
				};
				try {
					const onAbort = () => live.stop("Esc");
					attachSignal?.addEventListener("abort", onAbort, { once: true });
					try {
						await child.prompt(step.prompt);
					} finally {
						attachSignal?.removeEventListener("abort", onAbort);
					}
					if (chainStopWhy) throw new Error(`interrupted by ${chainStopWhy}`);
					if (live.wasStopped()) throw new RunStopped(live.why());
					const failure = providerFailure(child.session);
					if (failure) throw new Error(failure);
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
					gate.open = false;
					const why =
						chainStopWhy ||
						(live.wasStopped() ? "stopped" : err instanceof Error ? err.message : String(err));
					sweepMemberTasks(runId, false, Date.now(), why);
					if (live.wasStopped()) {
						live.unregister();
						throw new RunStopped(live.why());
					}
					stop({ status: "error", error: err instanceof Error ? err.message : String(err) });
					throw err;
				} finally {
					gate.open = false;
					unbindMail();
					live.unregister();
					stopCurrent = null;
					holder.abort = () => {};
					stop();
					child.session.dispose();
					if (live.wasStopped()) sweepMemberTasks(runId, false, Date.now(), "stopped");
				}
			}
			rec.status = "done";
			rec.endedAt = Date.now();
			rec.result = aggregateResult(seen, rec);
			ledger.finish(rec.subagentName, "done");
		} catch (err) {
			if (err instanceof RunStopped) {
				markStopped(rec, err.why);
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
			rec.endedAt = Date.now();
			ledger.finish(rec.subagentName, "error");
		} finally {
			chainLive.unregister();
			store.touch();
		}
	})();

	return { taskId, done };
}

export { aggregateResult } from "./chain-result.ts";
