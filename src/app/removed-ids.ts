/**
 * pi-subagents: the ids that a stop request removed.
 */

export const MAX_REMOVED_IDS = 50;

export function removedTaskMessage(taskId: string): string {
	return `Task "${taskId}" was stopped (Esc, reload, or quit) and its row was removed. Start a new task to continue.`;
}

export class RemovedIds {
	private ids: string[] = [];
	private readonly max: number;

	constructor(max = MAX_REMOVED_IDS) {
		this.max = max;
	}

	add(taskId: string): void {
		this.ids = this.ids.filter((id) => id !== taskId);
		this.ids.push(taskId);
		if (this.ids.length > this.max) this.ids = this.ids.slice(-this.max);
	}

	has(taskId: string): boolean {
		return this.ids.includes(taskId);
	}

	all(): string[] {
		return [...this.ids];
	}

	clear(): void {
		this.ids = [];
	}
}

export const removedIds = new RemovedIds();

export function unknownTaskMessage(taskId: string, memory: RemovedIds = removedIds): string {
	if (memory.has(taskId)) return removedTaskMessage(taskId);
	return `Unknown task_id "${taskId}". It may have expired.`;
}
