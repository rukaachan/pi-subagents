/**
 * pi-subagents: the vocabulary of one run.
 */

import type { FailureFamily } from "./failure.ts";
import type { SubagentConfig } from "./subagent/config.ts";
import type { SubagentRunResult } from "./run-result.ts";

export type TaskStatus = "running" | "done" | "error";
export type RunKind = "foreground" | "background" | "alias" | "chain" | "parallel";

/** The live cap; fan-out legs share it. */
export const MAX_LIVE_TASKS = 12;
export const MAX_DONE_TASKS = 20;

export interface ChainStep {
	idx: number;
	subagentName: string;
	prompt: string;
	status: "pending" | "running" | "done" | "error";
	report?: string;
	error?: string;
	startedAt?: number;
	endedAt?: number;
}

export interface ParallelLeg {
	idx: number;
	subagentName: string;
	prompt: string;
	status: "pending" | "running" | "done" | "error";
	report?: string;
	taskId?: string;
	error?: string;
}

export interface TaskRecord {
	taskId: string;
	subagentName: string;
	description: string;
	status: TaskStatus;
	createdAt: number;
	/** When the child session came up; absent while the run waits for a slot or a session. */
	startedAt?: number;
	endedAt?: number;
	result?: SubagentRunResult;
	error?: string;
	failure?: FailureFamily;
	fullDelivered: boolean;
	subagent: SubagentConfig;
	cwd: string;
	/** The Pi session that launched the run; absent on rows from older builds. */
	sessionId?: string;
	history: unknown[];
	modelId?: string;
	thinkingLevel?: string;
	tools?: string[];
	kind?: RunKind;
	/** 1-based attempt; only a retried background run goes above 1. */
	attempt?: number;
	/** The original prompt, kept so a failed leg can be retried. */
	prompt?: string;
	/** Groups the legs started by one delegate, team, parallel, or chain call. */
	runId?: string;
	dispatch?: { rule: string; matched: string };
	steps?: ChainStep[];
	legs?: ParallelLeg[];
}

/** Last timestamp in a saved transcript, used to freeze a legacy row clock. */
export function lastMessageAt(history: readonly unknown[]): number | undefined {
	for (let i = history.length - 1; i >= 0; i -= 1) {
		const message = history[i];
		if (!message || typeof message !== "object") continue;
		const stamp = (message as { timestamp?: unknown }).timestamp;
		if (typeof stamp === "number" && stamp > 0) return stamp;
	}
	return undefined;
}

/** Freeze a row read from disk: a run that was live cannot still be. */
export function freezeRestored(rec: TaskRecord): void {
	if (rec.status === "running") {
		rec.status = "error";
		rec.error = "Interrupted by Pi restart. History was not saved.";
		rec.fullDelivered = false;
		rec.endedAt = lastMessageAt(rec.history) ?? rec.startedAt ?? rec.createdAt;
		for (const step of rec.steps ?? []) {
			if (step.status === "running") {
				step.status = "error";
				step.error = "Interrupted by Pi restart.";
			}
		}
		return;
	}
	if (rec.endedAt === undefined) {
		rec.endedAt = lastMessageAt(rec.history) ?? rec.startedAt ?? rec.createdAt;
	}
}

export interface SpawnCounts {
	total: number;
	running: number;
	done: number;
	error: number;
	stopped: number;
	foreground: number;
	background: number;
	alias: number;
}
