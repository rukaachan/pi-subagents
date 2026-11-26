/**
 * pi-subagents: the shared team task board tool factory.
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentTeamCaller, AgentTeamRole } from "../../../domain/agent-team/index.ts";
import { renderAgentTeamCall, renderAgentTeamResult } from "../message/index.ts";
import { runAgentTeam } from "./agent-team-tool-run.ts";
import { PARAMETERS, type Params } from "./agent-team-tool-schema.ts";
import type { AgentTeamApi } from "./agent-team-tool-types.ts";

export type {
	AgentTeamApi,
	AgentTeamConflict,
	AgentTeamResolution,
	AgentTeamLaunchInput,
	AgentTeamLaunchLeg,
	AgentTeamLaunchResult,
	AgentTeamRoundInput,
	AgentTeamRoundResult,
} from "./agent-team-tool-types.ts";

function callerOf(member?: string, role: AgentTeamRole = "worker"): AgentTeamCaller {
	return member ? { name: member, lead: false, role } : { name: "lead", lead: true };
}

export function createAgentTeamTool(
	api: AgentTeamApi,
	member?: string,
	role: AgentTeamRole = "worker",
) {
	const caller = callerOf(member, role);
	return defineTool({
		name: "AgentTeam",
		label: "AgentTeam",
		description: member
			? "Shared agent team task board. List ready tasks, get one, claim it with the current revision, do the work, then complete. Use AgentTeamMessage to talk to a live teammate. Only the lead reassigns tasks; task changes never start another agent."
			: "Coordinate this session's agent team. Start with a prompt to create one task and one worker per leg, or turn agent team mode on to create tasks, delegate with Task, and reassign. Every member can list, get, claim with the current revision, do the work, and complete. Use AgentTeamMessage to talk to a live member. Task changes never start an agent; AgentTeam start does start workers.",
		parameters: PARAMETERS,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return runAgentTeam(api, params as Params, caller, ctx);
		},
		renderCall(args, theme) {
			return renderAgentTeamCall(args.action, theme);
		},
		renderResult(result, { expanded }, theme) {
			return renderAgentTeamResult(result, expanded, theme);
		},
	});
}
