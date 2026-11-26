/**
 * pi-subagents: board writes and their audit lines.
 */

import type {
	AgentTeamCaller,
	AgentTeamIsolation,
	AgentTeamOrigin,
	AgentTeamResult,
	AgentTeamUpdate,
} from "../../../domain/agent-team/index.ts";
import { createAgentTeamTask, updateAgentTeamTask } from "../../../domain/team-tasks/index.ts";
import { journalAgentTeamTask } from "./agent-team-journal.ts";
import { agentTeamBoard, agentTeamChanged, agentTeamMembers, getTask } from "./agent-team-store.ts";

export function createTask(
	input: {
		subject: string;
		description: string;
		blockedBy?: string[];
		writeScopes?: string[];
		acceptance?: string;
		verifyWith?: string;
		crossVerify?: boolean;
		isolation?: AgentTeamIsolation;
		origin?: AgentTeamOrigin;
		round?: number;
	},
	actor = "lead",
): AgentTeamResult {
	const result = createAgentTeamTask(agentTeamBoard(), input);
	journalAgentTeamTask({
		action: "create",
		taskId: result.ok ? result.task.id : "",
		revision: result.ok ? result.task.revision : 0,
		actor,
		ok: result.ok,
		...(result.ok ? {} : { error: result.error }),
	});
	if (result.ok) agentTeamChanged();
	return result;
}

export function updateTask(update: AgentTeamUpdate, caller: AgentTeamCaller): AgentTeamResult {
	const result = updateAgentTeamTask(agentTeamBoard(), update, caller, agentTeamMembers());
	journalAgentTeamTask({
		action: update.action,
		taskId: update.taskId,
		revision: getTask(update.taskId)?.task.revision ?? update.expectedRevision,
		actor: caller.name,
		ok: result.ok,
		...(result.ok ? {} : { error: result.error }),
	});
	if (result.ok) agentTeamChanged();
	return result;
}
