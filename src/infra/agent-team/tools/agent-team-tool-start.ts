/**
 * pi-subagents: AgentTeam start and round actions.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentTeamCaller } from "../../../domain/agent-team/index.ts";
import type { Params } from "./agent-team-tool-schema.ts";
import type { AgentTeamApi } from "./agent-team-tool-types.ts";
import { fail, ok, taskJson, taskLine } from "./agent-team-tool-view.ts";

export async function startAgentTeam(
	api: AgentTeamApi,
	params: Params,
	caller: AgentTeamCaller,
	ctx: ExtensionContext,
) {
	if (!caller.lead) return fail("Only the lead can start a team.");
	if (!params.prompt?.trim()) return fail("start needs prompt.");
	if (!api.launch) return fail("AgentTeam start is not available in this session.");
	const result = await api.launch(
		{
			prompt: params.prompt,
			...(params.roster ? { roster: params.roster } : {}),
			...(params.isolation ? { isolation: params.isolation } : {}),
		},
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

export async function startRound(
	api: AgentTeamApi,
	params: Params,
	caller: AgentTeamCaller,
	ctx: ExtensionContext,
) {
	if (!caller.lead) return fail("Only the lead can open a round.");
	if (!params.prompt?.trim()) return fail("round needs prompt.");
	if (!api.round) return fail("AgentTeam round is not available in this session.");
	const result = await api.round(
		{
			prompt: params.prompt,
			...(params.roster ? { roster: params.roster } : {}),
			...(params.directions ? { directions: params.directions } : {}),
			...(params.budget_tokens !== undefined ? { budgetTokens: params.budget_tokens } : {}),
			...(params.budget_minutes !== undefined ? { budgetMinutes: params.budget_minutes } : {}),
			...(params.brief ? { brief: params.brief } : {}),
			...(params.force ? { force: true } : {}),
			...(params.isolation ? { isolation: params.isolation } : {}),
		},
		ctx,
	);
	if (!result.ok) return fail(result.error);
	const rows = result.tasks.map(
		(leg, index) =>
			`${index + 1}. ${leg.name} — ${leg.taskId}${leg.runId ? ` · ${leg.runId}` : ""}`,
	);
	const state = `${result.started} started${result.queued > 0 ? ` · ${result.queued} queued` : ""}`;
	const budget = `${result.budget.tokens} tokens · ${Math.round(result.budget.ms / 60_000)} min`;
	const warning =
		result.warnings && result.warnings.length > 0 ? `\nWarning: ${result.warnings.join(" ")}` : "";
	return ok(`Round ${result.roundId} · ${state} · ${budget}\n${rows.join("\n")}${warning}`, {
		agent_team_id: result.agentTeamId,
		agent_team_mode: "on",
		round_id: result.roundId,
		run_id: result.runId,
		started: result.started,
		queued: result.queued,
		tasks: result.tasks,
		budget: result.budget,
		...(result.warnings ? { warnings: result.warnings } : {}),
	});
}

function liveLabel(api: AgentTeamApi, owner: string): string {
	if (owner === "nobody") return "unowned";
	if (!api.isLive) return "unknown";
	return api.isLive(owner) ? "live" : "not live";
}

export function resolveTask(api: AgentTeamApi, taskId: string, caller: AgentTeamCaller) {
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
	if (live.length > 0)
		parts.push(`ask ${live.map((hit) => hit.owner).join(", ")} to narrow the scope`);
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
