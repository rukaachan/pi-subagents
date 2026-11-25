/**
 * pi-subagents: what one teammate needs to join the board.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ChildExtras } from "../../../infra/host/session/index.ts";
import { createAgentTeamMessageTool } from "../../../infra/agent-team/message/index.ts";
import { createAgentTeamTool } from "../../../infra/agent-team/tools/index.ts";
import { liveMember, agentTeamMessageApi } from "../channel/index.ts";
import { joinAgentTeam, agentTeamApi, agentTeamEnabled } from "../board/index.ts";
import type { AgentTeamRole } from "../../../domain/agent-team/index.ts";
import { VERIFIER_BRIEF } from "../../../domain/policy/index.ts";

export interface AgentTeamChildExtras extends ChildExtras {
	member: string;
}

export interface AgentTeamChild {
	member: string;
	role: AgentTeamRole;
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
	role: AgentTeamRole = "worker",
): AgentTeamChildExtras | undefined {
	const agentTeam = joinAgentTeamChild(starter, key, gate, role);
	return agentTeam
		? {
				member: agentTeam.member,
				tools: agentTeam.tools,
				activate: role === "worker" ? ["AgentTeam", "AgentTeamMessage"] : ["AgentTeam"],
				promptPrefix: `${agentTeam.prompt}\n\n`,
			}
		: undefined;
}

/** Join a leg to the live team, or return nothing when team mode is off. */
export function joinAgentTeamChild(
	starter: string,
	key?: string,
	gate?: AgentTeamGate,
	role: AgentTeamRole = "worker",
): AgentTeamChild | undefined {
	if (!agentTeamEnabled()) return undefined;
	const member = joinAgentTeam(starter, key, undefined, role);
	return {
		member,
		role,
		tools: [
			createAgentTeamTool(
				{
					...agentTeamApi,
					isLive: (name) => Boolean(liveMember(name)),
					...(gate ? { canWork: () => gate.open } : {}),
				},
				member,
				role,
			),
			...(role === "worker" ? [createAgentTeamMessageTool(agentTeamMessageApi, member)] : []),
		],
		prompt: agentTeamPrompt(member, role),
	};
}

function agentTeamPrompt(member: string, role: AgentTeamRole): string {
	if (role === "verifier") {
		return [
			`[agent-team] You are "${member}", the verifier on this session's shared board.`,
			VERIFIER_BRIEF,
			"Read the task, its acceptance text, its result, and the files or commands that prove it. Check the repository yourself.",
			'Do not edit files and do not claim work. Call AgentTeam { action: "verify", task_id, expected_revision, verdict: "pass" | "fail", note } with a short reason.',
			"On pass, add fact with one checked, reusable fact; on fail, add excluded with the dead end so the team does not repeat it.",
			"A failed task returns to the board with your note.",
		].join("\n");
	}
	if (role === "advisor") {
		return [
			`[agent-team] You are "${member}", the advisor on this session's shared board.`,
			"Answer the lead's question with a short, concrete recommendation and the trade-off you see.",
			"Do not edit files, claim tasks, or verify work. Read the board when the question needs context.",
		].join("\n");
	}
	return [
		`[agent-team] You are "${member}" on this session's shared agent team board.`,
		"Use the AgentTeam tool: list ready tasks, get one, claim it with its current revision, do the work, then complete it.",
		"Only the lead assigns or reassigns tasks. Files are shared; stay inside the task's write scopes. A claim is refused while an in-progress task overlaps your scopes; report the blocker to the lead instead of widening.",
		"If you find work outside your task, report it in your final answer instead of doing it.",
		"Use AgentTeamMessage to send a finding to a live teammate, or wait for one; the lead is a valid target.",
		"Task changes never start another agent, so finish with a short report.",
	].join("\n");
}
