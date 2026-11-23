/**
 * pi-subagents: what one teammate needs to join the board.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ChildExtras } from "../infra/host-session.ts";
import { createTeamMessageTool } from "../infra/team-message-tool.ts";
import { createTeamTool } from "../infra/team-tool.ts";
import { liveMember, teamMessageApi } from "./team-mail.ts";
import { joinTeam, teamApi, teamEnabled } from "./team-store.ts";

export interface TeamChildExtras extends ChildExtras {
	member: string;
}

export interface TeamChild {
	member: string;
	tools: ToolDefinition[];
	prompt: string;
}

/** A run closes its gate when it stops; late claims are refused. */
export interface TeamGate {
	open: boolean;
}

/** Extras for the child session, or nothing when team mode is off. */
export function teamChildExtras(
	starter: string,
	key?: string,
	gate?: TeamGate,
): TeamChildExtras | undefined {
	const team = joinTeamChild(starter, key, gate);
	return team
		? {
				member: team.member,
				tools: team.tools,
				activate: ["Team", "TeamMessage"],
				promptPrefix: `${team.prompt}\n\n`,
			}
		: undefined;
}

/** Join a leg to the live team, or return nothing when team mode is off. */
export function joinTeamChild(
	starter: string,
	key?: string,
	gate?: TeamGate,
): TeamChild | undefined {
	if (!teamEnabled()) return undefined;
	const member = joinTeam(starter, key);
	return {
		member,
		tools: [
			createTeamTool(
				{
					...teamApi,
					isLive: (name) => Boolean(liveMember(name)),
					...(gate ? { canWork: () => gate.open } : {}),
				},
				member,
			),
			createTeamMessageTool(teamMessageApi, member),
		],
		prompt: teamPrompt(member),
	};
}

function teamPrompt(member: string): string {
	return [
		`[team] You are "${member}" on this session's shared team board.`,
		"Use the Team tool: list ready tasks, get one, claim it with its current revision, do the work, then complete it.",
		"Only the lead assigns or reassigns tasks. Files are shared; stay inside the task's write scopes. A claim is refused while an in-progress task overlaps your scopes; report the blocker to the lead instead of widening.",
		"If you find work outside your task, report it in your final answer instead of doing it.",
		"Use TeamMessage to send a finding to a live teammate, or wait for one; the lead is a valid target.",
		"Task changes never start another agent, so finish with a short report.",
	].join("\n");
}
