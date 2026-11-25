/**
 * pi-subagents: which run a board task points at.
 */

import type { TaskRecord } from "../../../domain/task/index.ts";
import type { TaskStorePort } from "../../../domain/task/index.ts";
import { getTask } from "./team-store.ts";

export type LinkedRun = { ok: true; runId: string; rec: TaskRecord } | { ok: false; error: string };

/** Resolve the run a team task is linked to, or say why it cannot open. */
export function linkedRun(store: TaskStorePort, taskId: string): LinkedRun {
	const runId = getTask(taskId)?.task.runId;
	if (!runId) return { ok: false, error: `Task ${taskId} has no run linked.` };
	const rec = store.get(runId);
	if (!rec) return { ok: false, error: `Run ${runId} is not in this session's store.` };
	return { ok: true, runId, rec };
}
