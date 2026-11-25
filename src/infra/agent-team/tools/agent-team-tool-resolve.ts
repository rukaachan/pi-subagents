/**
 * pi-subagents: resolve one task's scope conflicts.
 */

import type { AgentTeamCaller } from "../../../domain/agent-team/index.ts";
import type { AgentTeamApi } from "./agent-team-tool-types.ts";
import { fail, ok, taskJson, taskLine } from "./agent-team-tool-view.ts";

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
