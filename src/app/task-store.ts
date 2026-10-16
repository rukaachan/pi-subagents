/**
 * pi-subagents: the live task map.
 */
import { MAX_DONE_TASKS, MAX_LIVE_TASKS } from "./task-record.ts";
import type { TaskRecord } from "./task-record.ts";

export class TaskStore {
	private tasks = new Map<string, TaskRecord>();
	private order: string[] = [];

	/** Optional change hook for disk persistence. Never throws back. */
	onChange: (() => void) | null = null;

	private changed(): void {
		try {
			this.onChange?.();
		} catch {
			/* the hook never throws back */
		}
	}

	restore(records: TaskRecord[]): void {
		for (const rec of records) {
			if (!rec || typeof rec.taskId !== "string") continue;
			if (rec.status === "running") {
				rec.status = "error";
				rec.error = "Interrupted by Pi restart. History was not saved.";
				rec.fullDelivered = false;
				for (const step of rec.steps ?? []) {
					if (step.status === "running") {
						step.status = "error";
						step.error = "Interrupted by Pi restart.";
					}
				}
			}
			this.tasks.set(rec.taskId, rec);
			this.order.push(rec.taskId);
		}
		this.pruneDone();
	}

	snapshot(): TaskRecord[] {
		return this.list();
	}

	liveCount(): number {
		let n = 0;
		for (const t of this.tasks.values()) if (t.status === "running") n += 1;
		return n;
	}

	canStart(): boolean {
		return this.liveCount() < MAX_LIVE_TASKS;
	}

	add(rec: TaskRecord): void {
		this.tasks.set(rec.taskId, rec);
		this.order.push(rec.taskId);
		this.pruneDone();
		this.changed();
	}

	touch(): void {
		this.changed();
	}

	remove(taskId: string): boolean {
		const had = this.tasks.delete(taskId);
		if (!had) return false;
		this.order = this.order.filter((id) => id !== taskId);
		this.changed();
		return true;
	}

	get(taskId: string): TaskRecord | undefined {
		return this.tasks.get(taskId);
	}

	list(): TaskRecord[] {
		return this.order
			.map((id) => this.tasks.get(id))
			.filter((t): t is TaskRecord => t !== undefined);
	}

	private pruneDone(): void {
		const done = this.order.filter((id) => {
			const t = this.tasks.get(id);
			return t && t.status !== "running";
		});
		while (done.length > MAX_DONE_TASKS) {
			const drop = done.shift();
			if (!drop) break;
			this.tasks.delete(drop);
			this.order = this.order.filter((id) => id !== drop);
		}
	}
}
