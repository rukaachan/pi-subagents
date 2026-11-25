/**
 * pi-subagents: AgentTeam tool actions.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	MAX_AGENT_TEAM_TASKS,
	type AgentTeamCaller,
	type AgentTeamFilters,
	type AgentTeamUpdate,
} from "../../../domain/agent-team/index.ts";
import { UPDATE_ACTIONS, type Params } from "./agent-team-tool-schema.ts";
import { shutDown } from "./agent-team-tool-gate.ts";
import type { AgentTeamApi } from "./agent-team-tool-types.ts";
import { taskJson, taskLine } from "./agent-team-tool-view.ts";

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

function liveLabel(api: AgentTeamApi, owner: string): string {
	if (owner === "nobody") return "unowned";
	if (!api.isLive) return "unknown";
	return api.isLive(owner) ? "live" : "not live";
}

function resolveTask(api: AgentTeamApi, taskId: string, caller: AgentTeamCaller) {
	if (!caller.lead) return fail("Only the lead can resolve scope conflicts.", taskId);
	const resolved = api.resolve(taskId);
	if (!resolved) return fail(`Unknown task "${taskId}".`, taskId);
	const head = taskLine(resolved.task);
	if (resolved.conflicts.length === 0) {
		return ok(`${head}\nNo scope conflict.`, {
			agent_team_id: api.agentTeamId(),
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
			`${cold.map((hit) => `AgentTeam { action: "release", task_id: "${hit.id}", expected_revision: ${hit.revision} }`).join(", then ")}, then claim ${resolved.task.task.id}`,
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
		agent_team_id: api.agentTeamId(),
		task: taskJson(resolved.task),
		conflicts: rows,
		suggested: next,
	});
}

function boardSummary(api: AgentTeamApi): { head: string; details: Record<string, unknown> } {
	const summary = api.summary();
	const members = api.members();
	const rows = api.list({ limit: MAX_AGENT_TEAM_TASKS });
	const head = `AgentTeam ${summary.agentTeamId} · ${summary.enabled ? "on" : "off"} · ${summary.open} open · ${summary.done} done · ${members.length} members`;
	return {
		head,
		details: {
			agent_team_id: summary.agentTeamId,
			agent_team_mode: summary.enabled ? "on" : "off",
			open: summary.open,
			done: summary.done,
			members: members.map((member) => ({ name: member.name, starter: member.starter })),
			tasks: rows.map(taskJson),
		},
	};
}

async function startAgentTeam(
	api: AgentTeamApi,
	params: Params,
	caller: AgentTeamCaller,
	ctx: ExtensionContext,
) {
	if (!caller.lead) return fail("Only the lead can start a team.");
	if (!params.prompt?.trim()) return fail("start needs prompt.");
	if (!api.launch) return fail("AgentTeam start is not available in this session.");
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
	return ok(`AgentTeam started · ${state}\n${rows.join("\n")}${warning}`, {
		agent_team_id: result.agentTeamId,
		agent_team_mode: "on",
		run_id: result.runId,
		started: result.started,
		queued: result.queued,
		tasks: result.tasks,
		...(result.warnings ? { warnings: result.warnings } : {}),
	});
}

export async function runAgentTeam(
	api: AgentTeamApi,
	params: Params,
	caller: AgentTeamCaller,
	ctx: ExtensionContext,
) {
	if (params.action === "start") return startAgentTeam(api, params, caller, ctx);
	if (params.action === "status") {
		const board = boardSummary(api);
		const members = api.members();
		const roster = members.length
			? [`Members: ${members.map((member) => member.name).join(", ")}`]
			: [];
		return ok(
			[board.head, ...roster, ...api.list({ limit: MAX_AGENT_TEAM_TASKS }).map(taskLine)].join(
				"\n",
			),
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
			'Agent team mode is off. Use /subagents agent-teams on for a manual board, or AgentAgentTeam { action: "start", prompt } to launch work.',
		);
	}
	if (params.action === "create") {
		const shut = shutDown(api, caller);
		if (shut) return fail(shut);
		if (!params.subject) return fail("A task needs a subject.");
		const result = api.create(
			{
				subject: params.subject,
				description: params.description ?? "",
				...(params.blocked_by ? { blockedBy: params.blocked_by } : {}),
				...(params.write_scopes ? { writeScopes: params.write_scopes } : {}),
			},
			caller.name,
		);
		if (!result.ok) return fail(result.error);
		const view = api.get(result.task.id);
		if (!view) return fail(`Task ${result.task.id} disappeared.`, result.task.id);
		return ok(`Created ${taskLine(view)}`, {
			agent_team_id: api.agentTeamId(),
			task: taskJson(view),
		});
	}
	if (params.action === "list") {
		const filters: AgentTeamFilters = {};
		if (params.status) filters.status = params.status;
		if (params.unowned !== undefined) filters.unowned = params.unowned;
		if (params.ready !== undefined) filters.ready = params.ready;
		if (params.limit !== undefined) filters.limit = params.limit;
		const rows = params.owner ? api.list({ ...filters, owner: params.owner }) : api.list(filters);
		const text = rows.length === 0 ? "No tasks match." : rows.map(taskLine).join("\n");
		return ok(text, { agent_team_id: api.agentTeamId(), tasks: rows.map(taskJson) });
	}
	if (params.action === "get") {
		if (!params.task_id) return fail("get needs task_id.");
		const view = api.get(params.task_id);
		if (!view) return fail(`Unknown task "${params.task_id}".`, params.task_id);
		return ok(taskLine(view), { agent_team_id: api.agentTeamId(), task: taskJson(view) });
	}
	if (!UPDATE_ACTIONS.has(params.action)) return fail(`Unsupported action "${params.action}".`);
	if (!params.task_id) return fail(`${params.action} needs task_id.`);
	if (params.expected_revision === undefined) {
		return fail(`${params.action} needs expected_revision; read the task first.`, params.task_id);
	}
	const shut = shutDown(api, caller);
	if (shut) return fail(shut, params.task_id);
	const update: AgentTeamUpdate = {
		taskId: params.task_id,
		expectedRevision: params.expected_revision,
		action: params.action as AgentTeamUpdate["action"],
		...(params.subject !== undefined ? { subject: params.subject } : {}),
		...(params.description !== undefined ? { description: params.description } : {}),
		...(params.blocked_by !== undefined ? { blockedBy: params.blocked_by } : {}),
		...(params.write_scopes !== undefined ? { writeScopes: params.write_scopes } : {}),
		...(params.owner !== undefined ? { owner: params.owner } : {}),
		...(params.result !== undefined ? { result: params.result } : {}),
	};
	const result = api.update(update, caller);
	if (!result.ok) return fail(result.error, params.task_id);
	const view = api.get(result.task.id);
	if (!view) return fail(`Task ${result.task.id} is no longer on the board.`, result.task.id);
	const retried =
		result.retriedFrom !== undefined ? ` · retried from rev ${result.retriedFrom}` : "";
	return ok(`${params.action} · ${taskLine(view)}${retried}`, {
		agent_team_id: api.agentTeamId(),
		action: params.action,
		task: taskJson(view),
		...(result.retriedFrom !== undefined ? { retried_from: result.retriedFrom } : {}),
	});
}
