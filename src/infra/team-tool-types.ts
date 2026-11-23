/**
 * pi-subagents: Team tool contracts.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	TeamCaller,
	TeamFilters,
	TeamMember,
	TeamResult,
	TeamTaskStatus,
	TeamTaskView,
	TeamUpdate,
} from "../domain/team.ts";

export interface TeamConflict {
	id: string;
	scope: string;
	owner: string;
	revision: number;
	status: TeamTaskStatus;
}

export interface TeamResolution {
	task: TeamTaskView;
	conflicts: TeamConflict[];
}

export interface TeamLaunchInput {
	prompt: string;
	roster?: string[];
}

export interface TeamLaunchLeg {
	name: string;
	taskId: string;
	runId?: string;
}

export type TeamLaunchResult =
	| {
			ok: true;
			teamId: string;
			runId: string;
			tasks: TeamLaunchLeg[];
			started: number;
			queued: number;
	  }
	| { ok: false; error: string };

export interface TeamApi {
	active: () => boolean;
	teamId: () => string;
	summary: () => { teamId: string; enabled: boolean; open: number; done: number };
	members: () => TeamMember[];
	resolve: (taskId: string) => TeamResolution | undefined;
	isLive?: (name: string) => boolean;
	launch?: (input: TeamLaunchInput, ctx: ExtensionContext) => Promise<TeamLaunchResult>;
	create: (input: {
		subject: string;
		description: string;
		blockedBy?: string[];
		writeScopes?: string[];
	}) => TeamResult;
	update: (update: TeamUpdate, caller: TeamCaller) => TeamResult;
	list: (filters: TeamFilters) => TeamTaskView[];
	get: (taskId: string) => TeamTaskView | undefined;
}
