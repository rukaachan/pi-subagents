/**
 * pi-subagents: AgentTeam tool contracts.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	AgentTeamCaller,
	AgentTeamFilters,
	AgentTeamMember,
	AgentTeamResult,
	AgentTeamTaskStatus,
	AgentTeamTaskView,
	AgentTeamUpdate,
} from "../../../domain/agent-team/index.ts";

export interface AgentTeamConflict {
	id: string;
	scope: string;
	owner: string;
	revision: number;
	status: AgentTeamTaskStatus;
}

export interface AgentTeamResolution {
	task: AgentTeamTaskView;
	conflicts: AgentTeamConflict[];
}

export interface AgentTeamLaunchInput {
	prompt: string;
	roster?: string[];
}

export interface AgentTeamLaunchLeg {
	name: string;
	taskId: string;
	runId?: string;
}

export type AgentTeamLaunchResult =
	| {
			ok: true;
			agentTeamId: string;
			runId: string;
			tasks: AgentTeamLaunchLeg[];
			started: number;
			queued: number;
			warnings?: string[];
	  }
	| { ok: false; error: string };

export interface AgentTeamApi {
	active: () => boolean;
	agentTeamId: () => string;
	summary: () => { agentTeamId: string; enabled: boolean; open: number; done: number };
	members: () => AgentTeamMember[];
	resolve: (taskId: string) => AgentTeamResolution | undefined;
	isLive?: (name: string) => boolean;
	/** False once the run is stopped; late board changes must not land. */
	canWork?: () => boolean;
	launch?: (input: AgentTeamLaunchInput, ctx: ExtensionContext) => Promise<AgentTeamLaunchResult>;
	create: (
		input: {
			subject: string;
			description: string;
			blockedBy?: string[];
			writeScopes?: string[];
		},
		actor?: string,
	) => AgentTeamResult;
	update: (update: AgentTeamUpdate, caller: AgentTeamCaller) => AgentTeamResult;
	list: (filters: AgentTeamFilters) => AgentTeamTaskView[];
	get: (taskId: string) => AgentTeamTaskView | undefined;
}
