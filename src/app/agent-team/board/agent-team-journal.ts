/**
 * pi-subagents: one journal line per board write.
 */

import { journalWrite } from "../../../telemetry/journal/index.ts";

export interface AgentTeamTaskEvent {
	action: string;
	taskId: string;
	revision: number;
	actor: string;
	ok: boolean;
	error?: string;
}

/** Board audit line: ids and outcomes only, never subject, description, or result text. */
export function journalAgentTeamTask(entry: AgentTeamTaskEvent): void {
	journalWrite({
		event: "agent_team_task",
		action: entry.action,
		taskId: entry.taskId,
		revision: entry.revision,
		actor: entry.actor,
		ok: entry.ok,
		...(entry.error ? { error: entry.error } : {}),
	});
}
