/**
 * pi-subagents: one board task per line, for tools and resolve output.
 */

import type { TeamTaskView } from "../domain/team/index.ts";

export function taskLine(view: TeamTaskView): string {
	const task = view.task;
	const owner = task.owner ?? "unowned";
	const flags = [
		view.ready ? "ready" : "",
		view.blockedByOpen.length ? `blocked by ${view.blockedByOpen.join(",")}` : "",
		view.writeScopeWarnings.length ? view.writeScopeWarnings.join("; ") : "",
		task.lastError ? `last ${task.lastOwner ?? "a run"}: ${task.lastError.slice(0, 40)}` : "",
	].filter(Boolean);
	return `${task.id} [${task.status}] rev ${task.revision} · ${task.subject} · ${owner}${flags.length ? ` · ${flags.join(" · ")}` : ""}`;
}

export function taskJson(view: TeamTaskView): Record<string, unknown> {
	return {
		id: view.task.id,
		revision: view.task.revision,
		subject: view.task.subject,
		description: view.task.description,
		status: view.task.status,
		...(view.task.owner ? { owner: view.task.owner } : {}),
		blocked_by: view.task.blockedBy,
		write_scopes: view.task.writeScopes,
		...(view.task.lastOwner ? { last_owner: view.task.lastOwner } : {}),
		...(view.task.lastError ? { last_error: view.task.lastError } : {}),
		...(view.task.returnedAt ? { returned_at: view.task.returnedAt } : {}),
		...(view.task.runId ? { run_id: view.task.runId } : {}),
		...(view.task.result ? { result: view.task.result } : {}),
		ready: view.ready,
		blocked_by_open: view.blockedByOpen,
		write_scope_warnings: view.writeScopeWarnings,
	};
}
