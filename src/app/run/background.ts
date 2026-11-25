/**
 * pi-subagents: background driver.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ChildDeps } from "./child-port.ts";
import type { SubagentConfig } from "../../domain/subagent/index.ts";
import { isTransientFailure } from "../../domain/run/index.ts";
import { isRunStopped } from "../../domain/task/index.ts";
import { journalWrite } from "../../telemetry/journal/index.ts";
import { cut } from "../../telemetry/live/index.ts";
import { newTaskId } from "../../domain/task/index.ts";
import { liveStop } from "../live/index.ts";
import type { StoppableSession } from "../live/index.ts";
import { markStopped } from "../stop/index.ts";
import { ledger, markKind } from "../session/index.ts";
import { announceSettle } from "../live/index.ts";
import { sweepMemberTasks } from "../team/board/index.ts";
import { runBackgroundAttempt, type AttemptResult } from "./background-attempt.ts";
import { RetryPolicy, sleepUnlessStopped } from "../retry/index.ts";
import type { RunKind, TaskRecord } from "../../domain/task/index.ts";
import type { TaskStorePort } from "../../domain/task/index.ts";

export { resumeTask } from "./background-resume.ts";

const MAX_ATTEMPTS = 3;
const retryPolicy = new RetryPolicy();

export function launchBackground(
	store: TaskStorePort,
	sub: SubagentConfig,
	description: string,
	prompt: string,
	cwd: string,
	ctx: ExtensionContext,
	deps: ChildDeps,
	opts?: {
		kind?: Extract<RunKind, "background" | "parallel">;
		dispatch?: { rule: string; matched: string };
		contract?: readonly string[];
		runId?: string;
	},
): string {
	const kind = opts?.kind ?? "background";
	const parentSessionId = ctx.sessionManager.getSessionId();
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
		sessionId: parentSessionId,
		history: [],
		kind,
		prompt,
		...(opts?.runId ? { runId: opts.runId } : {}),
		dispatch: opts?.dispatch,
	};
	store.add(rec);
	ledger.begin(sub.name);
	markKind(sub.name, kind);

	// One live handle for the whole retry loop: the holder follows the current child.
	const holder: StoppableSession = { abort() {}, dispose() {} };
	let stopCurrent: ((why: string) => void) | null = null;
	const live = liveStop(
		taskId,
		sub.name,
		{
			abort: () => holder.abort(),
			dispose: () => holder.dispose(),
		},
		(why) => {
			markStopped(rec, why);
			store.touch();
			ledger.finish(sub.name, "stopped");
			sweepMemberTasks(taskId, false, Date.now(), "stopped");
			stopCurrent?.(why);
		},
	);

	void (async () => {
		let lastError = "run failed";
		try {
			for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
				rec.attempt = attempt;
				let outcome: AttemptResult;
				try {
					outcome = await runBackgroundAttempt({
						rec,
						sub,
						prompt,
						cwd,
						ctx,
						child: deps.child,
						store,
						kind,
						contract: opts?.contract,
						live,
						holder,
						setStopHandle: (fn) => {
							stopCurrent = fn;
						},
					});
				} catch (err) {
					if (isRunStopped(err)) return;
					const message = err instanceof Error ? err.message : String(err);
					outcome = { ok: false, error: message, transient: isTransientFailure(message) };
				}
				if (outcome.ok) {
					delete rec.error;
					ledger.finish(sub.name, "done");
					announceSettle(rec, parentSessionId);
					store.touch();
					return;
				}
				if (outcome.stopped || live.wasStopped()) return;
				lastError = outcome.error ?? "run failed";
				if (!isTransientFailure(lastError) || attempt === MAX_ATTEMPTS) break;
				const plan = retryPolicy.delayFor(attempt, lastError, sub.model);
				journalWrite({
					event: "retry",
					id: taskId,
					attempt,
					delayMs: plan.delayMs,
					reason: plan.reason,
					error: cut(lastError, 200),
				});
				rec.error = lastError;
				store.touch();
				if (!(await sleepUnlessStopped(plan.delayMs, () => live.wasStopped()))) return;
			}
			rec.status = "error";
			rec.error = lastError;
			rec.endedAt = Date.now();
			rec.fullDelivered = false;
			ledger.finish(sub.name, "error");
			announceSettle(rec, parentSessionId);
			store.touch();
		} finally {
			live.unregister();
		}
	})();

	return taskId;
}
