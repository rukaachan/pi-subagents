/**
 * pi-subagents: the plain-text team board.
 */

import {
	taskList,
	agentTeamMembers,
	agentTeamSummary,
} from "../../../app/agent-team/board/index.ts";
import { MAX_AGENT_TEAM_TASKS } from "../../../domain/agent-team/index.ts";

export function agentTeamText(): string {
	const summary = agentTeamSummary();
	const members = agentTeamMembers();
	const rows = taskList({ limit: MAX_AGENT_TEAM_TASKS });
	const head = `AgentTeam ${summary.agentTeamId} · ${summary.enabled ? "on" : "off"} · ${summary.open} open · ${summary.done} done`;
	const roster = members.length
		? [`Members: ${members.map((member) => member.name).join(", ")}`]
		: [];
	const lines = rows.map((view) => {
		const owner = view.task.owner ?? "unowned";
		const flags = [
			view.ready ? "ready" : "",
			view.blockedByOpen.length ? `blocked by ${view.blockedByOpen.join(",")}` : "",
			view.task.lastError ? `last ${view.task.lastOwner ?? "a run"}: ${view.task.lastError}` : "",
		]
			.filter(Boolean)
			.join(" · ");
		return `${view.task.id} [${view.task.status}] rev ${view.task.revision} · ${view.task.subject} · ${owner}${flags ? ` · ${flags}` : ""}`;
	});
	if (lines.length === 0)
		lines.push("No tasks yet. Press n in the Agent team tab or ask the lead.");
	return [head, ...roster, "", "TASKS", ...lines].join("\n");
}
