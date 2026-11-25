/**
 * pi-subagents: steers that arrive before the child session exists.
 */

const MAX_PENDING = 4;
const MAX_CHARS = 2000;

const pending = new Map<string, string[]>();

export function queueSteer(taskId: string, text: string): boolean {
	const one = text.trim();
	if (!one) return false;
	const list = pending.get(taskId) ?? [];
	if (list.length >= MAX_PENDING) return false;
	if (list.reduce((n, s) => n + s.length, 0) + one.length > MAX_CHARS) return false;
	list.push(one);
	pending.set(taskId, list);
	return true;
}

export function takeSteers(taskId: string): string[] {
	const list = pending.get(taskId) ?? [];
	pending.delete(taskId);
	return list;
}

export function dropSteers(taskId: string): void {
	pending.delete(taskId);
}
