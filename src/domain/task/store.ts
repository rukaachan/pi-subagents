/**
 * pi-subagents: the task store port.
 */
import type { TaskRecord } from "./task-record.ts";

export interface TaskStorePort {
	onChange: (() => void) | null;
	subscribe(fn: () => void): () => void;
	clear(): void;
	restore(records: TaskRecord[]): void;
	snapshot(): TaskRecord[];
	liveCount(): number;
	canStart(cap?: number): boolean;
	add(rec: TaskRecord): void;
	touch(): void;
	remove(taskId: string): boolean;
	get(taskId: string): TaskRecord | undefined;
	list(): TaskRecord[];
}
