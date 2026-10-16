/**
 * pi-subagents: the vocabulary of one run.
 */

import type { SubagentConfig } from "./subagent/config.ts";
import type { SubagentRunResult } from "./run-result.ts";

export type TaskStatus = "running" | "done" | "error";
export type RunKind = "foreground" | "background" | "alias" | "chain" | "parallel";

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
	result?: SubagentRunResult;
	error?: string;
	fullDelivered: boolean;
	subagent: SubagentConfig;
	cwd: string;
	history: unknown[];
	modelId?: string;
	thinkingLevel?: string;
	tools?: string[];
	kind?: RunKind;
	dispatch?: { rule: string; matched: string };
	steps?: ChainStep[];
	legs?: ParallelLeg[];
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
