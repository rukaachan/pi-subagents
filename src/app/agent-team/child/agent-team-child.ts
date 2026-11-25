/**
 * pi-subagents: what one teammate needs to join the board.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ChildExtras } from "../../../infra/host/session/index.ts";
import { createAgentTeamMessageTool } from "../../../infra/agent-team/message/index.ts";
import { createAgentTeamTool } from "../../../infra/agent-team/tools/index.ts";
import { liveMember, agentTeamMessageApi } from "../channel/index.ts";
import { joinAgentTeam, agentTeamApi, agentTeamEnabled } from "../board/index.ts";

export interface AgentTeamChildExtras extends ChildExtras {
	member: string;
}

export interface AgentTeamChild {
	member: string;
	tools: ToolDefinition[];
	prompt: string;
}

/** A run closes its gate when it stops; late claims are refused. */
export interface AgentTeamGate {
	open: boolean;
}

/** Extras for the child session, or nothing when team mode is off. */
export function agentTeamChildExtras(
	starter: string,
	key?: string,
	gate?: AgentTeamGate,
): AgentTeamChildExtras | undefined {
	const agentTeam = joinAgentTeamChild(starter, key, gate);
	return agentTeam
		? {
				member: agentTeam.member,
				tools: agentTeam.tools,
				activate: ["AgentTeam", "AgentTeamMessage"],
				promptPrefix: `${agentTeam.prompt}\n\n`,
			}
		: undefined;
}

/** Join a leg to the live team, or return nothing when team mode is off. */
export function joinAgentTeamChild(
	starter: string,
	key?: string,
	gate?: AgentTeamGate,
): AgentTeamChild | undefined {
	if (!agentTeamEnabled()) return undefined;
	const member = joinAgentTeam(starter, key);
	return {
		member,
		tools: [
			createAgentTeamTool(
				{
					...agentTeamApi,
					isLive: (name) => Boolean(liveMember(name)),
					...(gate ? { canWork: () => gate.open } : {}),
				},
				member,
			),
			createAgentTeamMessageTool(agentTeamMessageApi, member),
		],
		prompt: agentTeamPrompt(member),
	};
}

function agentTeamPrompt(member: string): string {
	return [
		`[agent-team] You are "${member}" on this session's shared agent team board.`,
		"Use the AgentTeam tool: list ready tasks, get one, claim it with its current revision, do the work, then complete it.",
		"Only the lead assigns or reassigns tasks. Files are shared; stay inside the task's write scopes. A claim is refused while an in-progress task overlaps your scopes; report the blocker to the lead instead of widening.",
		"If you find work outside your task, report it in your final answer instead of doing it.",
		"Use AgentTeamMessage to send a finding to a live teammate, or wait for one; the lead is a valid target.",
		"Task changes never start another agent, so finish with a short report.",
	].join("\n");
}
