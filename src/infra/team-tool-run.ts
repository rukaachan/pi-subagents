/**
 * pi-subagents: Team tool actions.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	MAX_TEAM_TASKS,
	type TeamCaller,
	type TeamFilters,
	type TeamTaskView,
	type TeamUpdate,
} from "../domain/team.ts";
import { UPDATE_ACTIONS, type Params } from "./team-tool-schema.ts";
import { shutDown } from "./team-tool-gate.ts";
import type { TeamApi } from "./team-tool-types.ts";

function taskLine(view: TeamTaskView): string {
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

function taskJson(view: TeamTaskView): Record<string, unknown> {
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
		ready: view.ready,
		blocked_by_open: view.blockedByOpen,
		write_scope_warnings: view.writeScopeWarnings,
	};
}

function fail(message: string, taskId?: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: { ...(taskId ? { task_id: taskId } : {}), error: message },
		isError: true,
	};
}

function ok(text: string, details: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function liveLabel(api: TeamApi, owner: string): string {
	if (owner === "nobody") return "unowned";
	if (!api.isLive) return "unknown";
	return api.isLive(owner) ? "live" : "not live";
}

function resolveTask(api: TeamApi, taskId: string, caller: TeamCaller) {
	if (!caller.lead) return fail("Only the lead can resolve scope conflicts.", taskId);
	const resolved = api.resolve(taskId);
	if (!resolved) return fail(`Unknown task "${taskId}".`, taskId);
	const head = taskLine(resolved.task);
	if (resolved.conflicts.length === 0) {
		return ok(`${head}\nNo scope conflict.`, {
			team_id: api.teamId(),
			task: taskJson(resolved.task),
			conflicts: [],
			suggested: "Claim it.",
		});
	}
	const rows = resolved.conflicts.map((hit) => ({ ...hit, live: liveLabel(api, hit.owner) }));
	const lines = [head, "Conflicts:"];
	for (const hit of rows) {
		lines.push(
			`- ${hit.id} [${hit.status}] rev ${hit.revision} · ${hit.scope} · ${hit.owner} · ${hit.live}`,
		);
	}
	const cold = rows.filter((hit) => hit.live === "not live");
	const live = rows.filter((hit) => hit.live === "live");
	const unknown = rows.filter((hit) => hit.live === "unknown");
	const parts: string[] = [];
	if (cold.length > 0) {
		parts.push(
			`${cold.map((hit) => `Team { action: "release", task_id: "${hit.id}", expected_revision: ${hit.revision} }`).join(", then ")}, then claim ${resolved.task.task.id}`,
		);
	}
	if (live.length > 0) {
		parts.push(`ask ${live.map((hit) => hit.owner).join(", ")} to narrow the scope`);
	}
	if (unknown.length > 0) {
		parts.push(`check whether ${unknown.map((hit) => hit.owner).join(", ")} is still running`);
	}
	const next = `Next: ${parts.join("; ")}.`;
	lines.push(next);
	return ok(lines.join("\n"), {
		team_id: api.teamId(),
		task: taskJson(resolved.task),
		conflicts: rows,
		suggested: next,
	});
}

function boardSummary(api: TeamApi): { head: string; details: Record<string, unknown> } {
	const summary = api.summary();
	const members = api.members();
	const rows = api.list({ limit: MAX_TEAM_TASKS });
	const head = `Team ${summary.teamId} · ${summary.enabled ? "on" : "off"} · ${summary.open} open · ${summary.done} done · ${members.length} members`;
	return {
		head,
		details: {
			team_id: summary.teamId,
			team_mode: summary.enabled ? "on" : "off",
			open: summary.open,
			done: summary.done,
			members: members.map((member) => ({ name: member.name, starter: member.starter })),
			tasks: rows.map(taskJson),
		},
	};
}

async function startTeam(api: TeamApi, params: Params, caller: TeamCaller, ctx: ExtensionContext) {
	if (!caller.lead) return fail("Only the lead can start a team.");
	if (!params.prompt?.trim()) return fail("start needs prompt.");
	if (!api.launch) return fail("Team start is not available in this session.");
	const result = await api.launch(
		{ prompt: params.prompt, ...(params.roster ? { roster: params.roster } : {}) },
		ctx,
	);
	if (!result.ok) return fail(result.error);
	const rows = result.tasks.map(
		(leg, index) =>
			`${index + 1}. ${leg.name} — ${leg.taskId}${leg.runId ? ` · ${leg.runId}` : ""}`,
	);
	const state = `${result.started} started${result.queued > 0 ? ` · ${result.queued} queued` : ""}`;
	const warning =
		result.warnings && result.warnings.length > 0 ? `\nWarning: ${result.warnings.join(" ")}` : "";
	return ok(`Team started · ${state}\n${rows.join("\n")}${warning}`, {
		team_id: result.teamId,
		team_mode: "on",
		run_id: result.runId,
		started: result.started,
		queued: result.queued,
		tasks: result.tasks,
		...(result.warnings ? { warnings: result.warnings } : {}),
	});
}

export async function runTeam(
	api: TeamApi,
	params: Params,
	caller: TeamCaller,
	ctx: ExtensionContext,
) {
	if (params.action === "start") return startTeam(api, params, caller, ctx);
	if (params.action === "status") {
		const board = boardSummary(api);
		const members = api.members();
		const roster = members.length
			? [`Members: ${members.map((member) => member.name).join(", ")}`]
			: [];
		return ok(
			[board.head, ...roster, ...api.list({ limit: MAX_TEAM_TASKS }).map(taskLine)].join("\n"),
			{
				...board.details,
			},
		);
	}
	if (params.action === "resolve") {
		if (!params.task_id) return fail("resolve needs task_id.");
		return resolveTask(api, params.task_id, caller);
	}
	if (!api.active()) {
		return fail(
			'Team mode is off. Use /subagents team on for a manual board, or Team { action: "start", prompt } to launch work.',
		);
	}
	if (params.action === "create") {
		const shut = shutDown(api, caller);
		if (shut) return fail(shut);
		if (!params.subject) return fail("A task needs a subject.");
		const result = api.create({
			subject: params.subject,
			description: params.description ?? "",
			...(params.blocked_by ? { blockedBy: params.blocked_by } : {}),
			...(params.write_scopes ? { writeScopes: params.write_scopes } : {}),
		});
		if (!result.ok) return fail(result.error);
		const view = api.get(result.task.id);
		if (!view) return fail(`Task ${result.task.id} disappeared.`, result.task.id);
		return ok(`Created ${taskLine(view)}`, { team_id: api.teamId(), task: taskJson(view) });
	}
	if (params.action === "list") {
		const filters: TeamFilters = {};
		if (params.status) filters.status = params.status;
		if (params.unowned !== undefined) filters.unowned = params.unowned;
		if (params.ready !== undefined) filters.ready = params.ready;
		if (params.limit !== undefined) filters.limit = params.limit;
		const rows = params.owner ? api.list({ ...filters, owner: params.owner }) : api.list(filters);
		const text = rows.length === 0 ? "No tasks match." : rows.map(taskLine).join("\n");
		return ok(text, { team_id: api.teamId(), tasks: rows.map(taskJson) });
	}
	if (params.action === "get") {
		if (!params.task_id) return fail("get needs task_id.");
		const view = api.get(params.task_id);
		if (!view) return fail(`Unknown task "${params.task_id}".`, params.task_id);
		return ok(taskLine(view), { team_id: api.teamId(), task: taskJson(view) });
	}
	if (!UPDATE_ACTIONS.has(params.action)) return fail(`Unsupported action "${params.action}".`);
	if (!params.task_id) return fail(`${params.action} needs task_id.`);
	if (params.expected_revision === undefined) {
		return fail(`${params.action} needs expected_revision; read the task first.`, params.task_id);
	}
	const shut = shutDown(api, caller);
	if (shut) return fail(shut, params.task_id);
	const update: TeamUpdate = {
		taskId: params.task_id,
		expectedRevision: params.expected_revision,
		action: params.action as TeamUpdate["action"],
		...(params.subject !== undefined ? { subject: params.subject } : {}),
		...(params.description !== undefined ? { description: params.description } : {}),
		...(params.blocked_by !== undefined ? { blockedBy: params.blocked_by } : {}),
		...(params.write_scopes !== undefined ? { writeScopes: params.write_scopes } : {}),
		...(params.owner !== undefined ? { owner: params.owner } : {}),
	};
	const result = api.update(update, caller);
	if (!result.ok) return fail(result.error, params.task_id);
	const view = api.get(result.task.id);
	if (!view) return fail(`Task ${result.task.id} is no longer on the board.`, result.task.id);
	const retried =
		result.retriedFrom !== undefined ? ` · retried from rev ${result.retriedFrom}` : "";
	return ok(`${params.action} · ${taskLine(view)}${retried}`, {
		team_id: api.teamId(),
		action: params.action,
		task: taskJson(view),
		...(result.retriedFrom !== undefined ? { retried_from: result.retriedFrom } : {}),
	});
}
