/**
 * pi-subagents: the AgentTeam tool API bound to the live board.
 */

import type { AgentTeamApi } from "../../../infra/agent-team/tools/index.ts";
import {
	agentTeamActive,
	agentTeamBoard,
	agentTeamMembers,
	agentTeamSummary,
	currentAgentTeamId,
	getTask,
	resolveTask,
	taskList,
} from "./agent-team-store.ts";
import { createTask, updateTask } from "./mutations.ts";

export const agentTeamApi: AgentTeamApi = {
	active: agentTeamActive,
	agentTeamId: currentAgentTeamId,
	summary: agentTeamSummary,
	members: agentTeamMembers,
	ledger: () => agentTeamBoard().ledger,
	create: createTask,
	update: updateTask,
	list: taskList,
	get: getTask,
	resolve: resolveTask,
};
