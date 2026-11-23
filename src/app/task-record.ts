/**
 * pi-subagents: one row per run.
 */

import type { RunKind, TaskRecord } from "../domain/task.ts";
import type { SubagentConfig } from "../domain/subagent/config.ts";

export { MAX_DONE_TASKS, MAX_LIVE_TASKS } from "../domain/task.ts";
export type {
	ChainStep,
	ParallelLeg,
	RunKind,
	SpawnCounts,
	TaskRecord,
	TaskStatus,
} from "../domain/task.ts";

let seq = 0;

export function newTaskId(): string {
	seq += 1;
	return `task-${Date.now().toString(36)}-${seq}`;
}

/** One id for a group of legs launched by one orchestration call. */
export function newRunId(kind: RunKind): string {
	seq += 1;
	return `run-${kind}-${Date.now().toString(36)}-${seq}`;
}

export function newRecord(
	subagent: SubagentConfig,
	description: string,
	cwd: string,
	kind: RunKind,
	sessionId?: string,
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
		...(sessionId ? { sessionId } : {}),
		history: [],
		kind,
	};
}
