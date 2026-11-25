/**
 * pi-subagents: which runs belong to this project and this Pi session.
 */

import type { TaskRecord } from "../domain/task/index.ts";

export interface TaskScope {
	cwd: string;
	sessionId?: string;
}

export function inTaskScope(rec: TaskRecord, scope: TaskScope): boolean {
	if (rec.cwd !== scope.cwd) return false;
	if (scope.sessionId === undefined) return true;
	return rec.sessionId === scope.sessionId;
}

export function scopeTasks(records: readonly TaskRecord[], scope: TaskScope): TaskRecord[] {
	return records.filter((rec) => inTaskScope(rec, scope));
}
