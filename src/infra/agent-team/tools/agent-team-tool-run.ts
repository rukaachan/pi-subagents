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
import { fail, ok, taskJson, taskLine } from "./agent-team-tool-view.ts";
import { startAgentTeam, startRound, resolveTask } from "./agent-team-tool-start.ts";

export function boardSummary(api: AgentTeamApi): {
	head: string;
	details: Record<string, unknown>;
} {
	const summary = api.summary();
	const members = api.members();
	const rows = api.list({ limit: MAX_AGENT_TEAM_TASKS });
	const ledger = api.ledger?.() ?? [];
	const facts = summary.facts > 0 ? ` · ${summary.facts} facts` : "";
	const head = `AgentTeam ${summary.agentTeamId} · ${summary.enabled ? "on" : "off"} · ${summary.open} open · ${summary.review} review · ${summary.done} done · ${members.length} members${facts}`;
	return {
		head,
		details: {
			agent_team_id: summary.agentTeamId,
			agent_team_mode: summary.enabled ? "on" : "off",
			open: summary.open,
			review: summary.review,
			done: summary.done,
			facts: summary.facts,
			members: members.map((member) => ({ name: member.name, starter: member.starter })),
			ledger: ledger.slice(-20).map((entry) => ({
				kind: entry.kind,
				text: entry.text,
				task_id: entry.taskId,
				by: entry.by,
				at: entry.at,
			})),
			tasks: rows.map(taskJson),
		},
	};
}

export async function runAgentTeam(
	api: AgentTeamApi,
	params: Params,
	caller: AgentTeamCaller,
	ctx: ExtensionContext,
) {
	if (params.action === "start") return startAgentTeam(api, params, caller, ctx);
	if (params.action === "round") return startRound(api, params, caller, ctx);
	if (params.action === "advise") {
		if (!caller.lead) return fail("Only the lead can ask the advisor.");
		if (!params.question?.trim()) return fail("advise needs question.");
		if (!api.advise) return fail("AgentTeam advise is not available in this session.");
		const result = await api.advise(params.question, params.task_id, ctx);
		if (!result.ok) return fail(result.error, params.task_id);
		return ok(result.text, {
			agent_team_id: api.agentTeamId(),
			...(params.task_id ? { task_id: params.task_id } : {}),
			advice: result.text,
		});
	}
	if (params.action === "brief") {
		if (!caller.lead) return fail("Only the lead can ask for a brief.");
		if (!api.brief) return fail("AgentTeam brief is not available in this session.");
		const result = await api.brief(params.question, ctx);
		if (!result.ok) return fail(result.error);
		return ok(result.text, {
			agent_team_id: api.agentTeamId(),
			brief: result.text,
		});
	}
	if (params.action === "promote") {
		if (!caller.lead) return fail("Only the lead can promote a task.");
		if (!params.task_id) return fail("promote needs task_id.");
		if (!api.promote) return fail("AgentTeam promote is not available in this session.");
		const result = api.promote(params.task_id, params.confirm === true);
		if (!result.ok) return fail(result.error, params.task_id);
		const text = result.written
			? `Draft written to ${result.path}.\n\n${result.content}`
			: result.content;
		return ok(text, {
			agent_team_id: api.agentTeamId(),
			task_id: params.task_id,
			promoted: result.written,
			name: result.name,
			...(result.path ? { path: result.path } : {}),
		});
	}
	if (params.action === "worktree") {
		if (!caller.lead) return fail("Only the lead can manage worktrees.");
		if (!params.task_id) return fail("worktree needs task_id.");
		if (!params.worktree_action) return fail("worktree needs worktree_action.");
		if (!api.worktree) return fail("AgentTeam worktree is not available in this session.");
		const result = api.worktree(params.task_id, params.worktree_action, ctx);
		if (!result.ok) return fail(result.error, params.task_id);
		return ok(result.text, {
			agent_team_id: api.agentTeamId(),
			task_id: params.task_id,
			task: result.task,
		});
	}
	if (params.action === "status") {
		const board = boardSummary(api);
		const members = api.members();
		const roster = members.length
			? [`Members: ${members.map((member) => member.name).join(", ")}`]
			: [];
		const facts = (api.ledger?.() ?? [])
			.filter((entry) => entry.kind === "fact")
			.slice(-5)
			.map((entry) => `fact ${entry.taskId}: ${entry.text.slice(0, 120)}`);
		return ok(
			[
				board.head,
				...roster,
				...facts,
				...api.list({ limit: MAX_AGENT_TEAM_TASKS }).map(taskLine),
			].join("\n"),
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
			'Agent team mode is off. Use /subagents agent-teams on for a manual board, or AgentTeam { action: "start", prompt } to launch work.',
		);
	}
	if (
		caller.role === "advisor" &&
		!["status", "list", "get", "advise", "resolve"].includes(params.action)
	) {
		return fail("The advisor is read-only.");
	}
	if (
		caller.role === "verifier" &&
		!["status", "list", "get", "verify", "resolve"].includes(params.action)
	) {
		return fail("The verifier may only read and verify.");
	}
	if (params.action === "create") {
		if (!caller.lead) return fail("Only the lead can create tasks.");
		const shut = shutDown(api, caller);
		if (shut) return fail(shut);
		if (!params.subject) return fail("A task needs a subject.");
		const result = api.create(
			{
				subject: params.subject,
				description: params.description ?? "",
				...(params.blocked_by ? { blockedBy: params.blocked_by } : {}),
				...(params.write_scopes ? { writeScopes: params.write_scopes } : {}),
				...(params.acceptance ? { acceptance: params.acceptance } : {}),
				...(params.verify_with ? { verifyWith: params.verify_with } : {}),
				...(params.cross_verify !== undefined ? { crossVerify: params.cross_verify } : {}),
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
		...(params.acceptance !== undefined ? { acceptance: params.acceptance } : {}),
		...(params.verify_with !== undefined ? { verifyWith: params.verify_with } : {}),
		...(params.cross_verify !== undefined ? { crossVerify: params.cross_verify } : {}),
		...(params.isolation !== undefined ? { isolation: params.isolation } : {}),
		...(params.verdict !== undefined ? { verdict: params.verdict } : {}),
		...(params.scope !== undefined ? { scope: params.scope } : {}),
		...(params.note !== undefined ? { note: params.note } : {}),
		...(params.fact !== undefined ? { fact: params.fact } : {}),
		...(params.excluded !== undefined ? { excluded: params.excluded } : {}),
		...(params.override !== undefined ? { override: params.override } : {}),
	};
	const result = api.update(update, caller);
	if (!result.ok) return fail(result.error, params.task_id);
	const view = api.get(result.task.id);
	if (!view) return fail(`Task ${result.task.id} is no longer on the board.`, result.task.id);
	if (params.action === "complete" && result.task.status === "in_review") {
		api.startVerify?.(result.task.id, ctx);
	}
	if (
		params.action === "verify" &&
		params.scope !== "cross" &&
		view.task.status === "in_review" &&
		view.task.crossVerify &&
		view.task.verdict === "pass" &&
		!view.task.crossVerdict
	) {
		api.startCrossVerify?.(view.task.id, ctx);
	}
	const retried =
		result.retriedFrom !== undefined ? ` · retried from rev ${result.retriedFrom}` : "";
	const review = result.task.status === "in_review" ? " · sent to review" : "";
	return ok(`${params.action} · ${taskLine(view)}${retried}${review}`, {
		agent_team_id: api.agentTeamId(),
		action: params.action,
		task: taskJson(view),
		...(result.retriedFrom !== undefined ? { retried_from: result.retriedFrom } : {}),
	});
}
