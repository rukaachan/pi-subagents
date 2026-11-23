/**
 * pi-subagents: the shared team task board tool factory.
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import type { TeamCaller } from "../domain/team.ts";
import { renderTeamCall, renderTeamResult } from "./team-render.ts";
import { runTeam } from "./team-tool-run.ts";
import { PARAMETERS, type Params } from "./team-tool-schema.ts";
import type { TeamApi } from "./team-tool-types.ts";

export type {
	TeamApi,
	TeamConflict,
	TeamResolution,
	TeamLaunchInput,
	TeamLaunchLeg,
	TeamLaunchResult,
} from "./team-tool-types.ts";

function callerOf(member?: string): TeamCaller {
	return member ? { name: member, lead: false } : { name: "lead", lead: true };
}

export function createTeamTool(api: TeamApi, member?: string) {
	const caller = callerOf(member);
	return defineTool({
		name: "Team",
		label: "Team",
		description: member
			? "Shared team task board. List ready tasks, get one, claim it with the current revision, do the work, then complete. Use TeamMessage to talk to a live teammate. Only the lead reassigns tasks; task changes never start another agent."
			: "Coordinate this session's team. Start with a prompt to create one task and one worker per leg, or turn team mode on to create tasks, delegate with Task, and reassign. Every member can list, get, claim with the current revision, do the work, and complete. Use TeamMessage to talk to a live member. Task changes never start an agent; Team start does start workers.",
		parameters: PARAMETERS,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return runTeam(api, params as Params, caller, ctx);
		},
		renderCall(args, theme) {
			return renderTeamCall(args.action, theme);
		},
		renderResult(result, { expanded }, theme) {
			return renderTeamResult(result, expanded, theme);
		},
	});
}
