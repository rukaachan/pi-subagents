/**
 * pi-subagents: one row per run.
 */

import type { RunKind, TaskRecord } from "../domain/task.ts";
import type { SubagentConfig } from "../domain/subagent/config.ts";

export type {
	ChainStep,
	ParallelLeg,
	RunKind,
	SpawnCounts,
	TaskRecord,
	TaskStatus,
} from "../domain/task.ts";

/** The live cap; fan-out legs share it. */
export const MAX_LIVE_TASKS = 12;
export const MAX_DONE_TASKS = 20;

let seq = 0;

export function newTaskId(): string {
	seq += 1;
	return `task-${Date.now().toString(36)}-${seq}`;
}

export function newRecord(
	subagent: SubagentConfig,
	description: string,
	cwd: string,
	kind: RunKind,
): TaskRecord {
	return {
		taskId: newTaskId(),
		subagentName: subagent.name,
		description,
		status: "running",
		createdAt: Date.now(),
		fullDelivered: false,
		subagent,
		cwd,
		history: [],
		kind,
	};
}
