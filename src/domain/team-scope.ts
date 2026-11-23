/**
 * pi-subagents: write-scope reservations on the team board.
 */

export interface ScopeTask {
	id: string;
	status: string;
	owner?: string;
	writeScopes: readonly string[];
}

export interface ScopeBoard {
	tasks: readonly ScopeTask[];
}

export interface ScopeHit {
	id: string;
	scope: string;
	/** The blocker's reserved prefix that overlaps. */
	reserved?: string;
	owner: string;
}

function overlaps(a: string, b: string): boolean {
	return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function writeScopeWarnings(task: ScopeTask, board: ScopeBoard): string[] {
	if (task.status !== "pending" && task.status !== "in_progress") return [];
	const out: string[] = [];
	for (const other of board.tasks) {
		if (other.id === task.id || other.status !== "in_progress") continue;
		const hit = task.writeScopes.find((scope) =>
			other.writeScopes.some((peer) => overlaps(scope, peer)),
		);
		if (hit) out.push(`overlaps ${other.id} (${hit})`);
		if (out.length >= 5) break;
	}
	return out;
}

/** In-progress tasks whose scopes overlap this task's scopes (or a proposed set). */
export function scopeConflicts(
	task: ScopeTask,
	board: ScopeBoard,
	scopes: readonly string[] = task.writeScopes,
): ScopeHit[] {
	const out: ScopeHit[] = [];
	for (const other of board.tasks) {
		if (other.id === task.id || other.status !== "in_progress") continue;
		let scope: string | undefined;
		let reserved: string | undefined;
		for (const one of scopes) {
			const peer = other.writeScopes.find((candidate) => overlaps(one, candidate));
			if (peer) {
				scope = one;
				reserved = peer;
				break;
			}
		}
		if (!scope || !reserved) continue;
		out.push({ id: other.id, scope, reserved, owner: other.owner ?? "nobody" });
		if (out.length >= 5) break;
	}
	return out;
}

export function scopeConflictError(
	task: ScopeTask,
	hits: readonly ScopeHit[],
	verb = "start",
): string {
	const first = hits[0];
	if (!first) return `Task ${task.id} cannot ${verb}: scope conflict.`;
	return `Task ${task.id} cannot ${verb}: scope "${first.reserved ?? first.scope}" overlaps ${first.id} (in progress, ${first.owner}). Wait for it to finish or narrow the scope.`;
}
