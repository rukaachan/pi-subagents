/**
 * pi-subagents: one board task per line, for tools and resolve output.
 */

import type { AgentTeamTaskView } from "../../../domain/agent-team/index.ts";

export function taskLine(view: AgentTeamTaskView): string {
	const task = view.task;
	const owner = task.owner ?? "unowned";
	const flags = [
		view.ready ? "ready" : "",
		view.blockedByOpen.length ? `blocked by ${view.blockedByOpen.join(",")}` : "",
		view.writeScopeWarnings.length ? view.writeScopeWarnings.join("; ") : "",
		task.acceptance ? `acceptance set` : "",
		task.verdict ? `verdict ${task.verdict}` : "",
		task.lastError ? `last ${task.lastOwner ?? "a run"}: ${task.lastError.slice(0, 40)}` : "",
	].filter(Boolean);
	return `${task.id} [${task.status}] rev ${task.revision} · ${task.subject} · ${owner}${flags.length ? ` · ${flags.join(" · ")}` : ""}`;
}

export function taskJson(view: AgentTeamTaskView): Record<string, unknown> {
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
		...(view.task.acceptance ? { acceptance: view.task.acceptance } : {}),
		...(view.task.verifyWith ? { verify_with: view.task.verifyWith } : {}),
		...(view.task.verdict ? { verdict: view.task.verdict } : {}),
		...(view.task.verifiedBy ? { verified_by: view.task.verifiedBy } : {}),
		...(view.task.verifiedAt ? { verified_at: view.task.verifiedAt } : {}),
		...(view.task.verifyRunId ? { verify_run_id: view.task.verifyRunId } : {}),
		...(view.task.origin ? { origin: view.task.origin } : {}),
		ready: view.ready,
		blocked_by_open: view.blockedByOpen,
		write_scope_warnings: view.writeScopeWarnings,
	};
}

export function fail(message: string, taskId?: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: { ...(taskId ? { task_id: taskId } : {}), error: message },
		isError: true,
	};
}

export function ok(text: string, details: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}
