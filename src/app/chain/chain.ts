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
	usageEnd,
} from "../../domain/run/index.ts";
import type { ChildDeps } from "../run/index.ts";
import { withGateJournal } from "../guards/index.ts";
import { agentTeamChildExtras } from "../agent-team/child/index.ts";
import { bindAgentTeamMember } from "../agent-team/channel/index.ts";
import { getTask, sweepMemberTasks } from "../agent-team/board/index.ts";
import { requestAgentTeamVerify } from "../agent-team/verify/index.ts";
import { completeTask, ensureTask, taskPrompt } from "../agent-team/auto/index.ts";
import { ledger, markKind } from "../session/index.ts";
import { newTaskId } from "../../domain/task/index.ts";
import type { TaskStorePort } from "../../domain/task/index.ts";
import type { SubagentRunResult } from "../../domain/run/index.ts";
import { liveStop, type LiveStop, type StoppableSession } from "../live/index.ts";
import { markStopped } from "../stop/index.ts";
import { RunStopped } from "../../domain/task/index.ts";
import { aggregateResult } from "./chain-result.ts";
import { stepPrompt, type ChainRun, type ChainSpec } from "./chain-spec.ts";
import { newChainRecord } from "./chain-record.ts";
export { MAX_PRIOR_REPORT, newChainSteps, stepPrompt } from "./chain-spec.ts";
export type { ChainRun, ChainSpec } from "./chain-spec.ts";

export function runChain(
	store: TaskStorePort,
	spec: ChainSpec,
	subagents: SubagentConfig[],
	cwd: string,
	ctx: ExtensionContext,
	deps: ChildDeps,
	description: string,
	_kind: "foreground" | "background" = "background",
	attachSignal?: AbortSignal,
): ChainRun | { error: string } {
	const taskId = newTaskId();
	const rec = newChainRecord({
		taskId,
		spec,
		subagents,
		cwd,
		sessionId: ctx.sessionManager.getSessionId(),
		description,
	});
	if (!rec) return { error: "Chain has no subagents." };
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
		let priorTaskId: string | undefined;
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
				const ensured = ensureTask({
					sub,
					prompt: step.prompt,
					origin: "chain",
					runId,
					...(priorTaskId ? { blockedBy: [priorTaskId] } : {}),
				});
				if (!ensured.ok) throw new Error(ensured.error);
				let teamTaskId = ensured.taskId;
				let stepCwd = ensured.cwd ?? cwd;
				const gate = { open: true };
				const agentTeam = agentTeamChildExtras(sub.name, runId, gate);
				if (agentTeam && teamTaskId) {
					const assigned = ensureTask({
						sub,
						prompt: step.prompt,
						origin: "chain",
						existingTaskId: teamTaskId,
						member: agentTeam.member,
					});
					if (!assigned.ok) throw new Error(assigned.error);
					teamTaskId = assigned.taskId;
					if (assigned.cwd) stepCwd = assigned.cwd;
				}
				const teamPrefix = teamTaskId ? `${taskPrompt(teamTaskId)}\n\n` : "";
				const child = await deps.child.create(sub, stepCwd, ctx, withGateJournal(agentTeam));
				const unbindMail = agentTeam
					? bindAgentTeamMember(
							agentTeam.member,
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
					cwd: stepCwd,
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
						await child.prompt(`${teamPrefix}${step.prompt}`);
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
					if (teamTaskId) {
						completeTask(teamTaskId, text);
						if (getTask(teamTaskId)?.task.status === "in_review")
							requestAgentTeamVerify(teamTaskId, ctx);
						priorTaskId = teamTaskId;
					}
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
						report: text,
						promptChars: step.prompt.length,
						...usageEnd(rec.result?.usage),
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
					stop({
						status: "error",
						error: err instanceof Error ? err.message : String(err),
						promptChars: step.prompt.length,
						...usageEnd(rec.result?.usage),
					});
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
