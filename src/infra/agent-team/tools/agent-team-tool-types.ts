/**
 * pi-subagents: AgentTeam tool contracts.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	AgentTeamCaller,
	AgentTeamFilters,
	AgentTeamIsolation,
	AgentTeamLedgerEntry,
	AgentTeamMember,
	AgentTeamResult,
	AgentTeamTask,
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
	/** One prompt per roster leg; falls back to the shared prompt. */
	directions?: string[];
	/** Present when this launch opens a numbered round. */
	roundId?: number;
	/** Shared brief prepended to every leg prompt. */
	brief?: string;
	isolation?: AgentTeamIsolation;
}

export interface AgentTeamLaunchLeg {
	name: string;
	taskId: string;
	runId?: string;
	worktree?: string;
}

export interface AgentTeamRoundInput {
	prompt: string;
	roster?: string[];
	directions?: string[];
	budgetTokens?: number;
	budgetMinutes?: number;
	brief?: string;
	force?: boolean;
	isolation?: AgentTeamIsolation;
}

export type AgentTeamRoundResult =
	| {
			ok: true;
			roundId: number;
			agentTeamId: string;
			runId: string;
			tasks: AgentTeamLaunchLeg[];
			started: number;
			queued: number;
			warnings?: string[];
			budget: { tokens: number; ms: number };
	  }
	| { ok: false; error: string };

export type AgentTeamPromoteResult =
	| {
			ok: true;
			name: string;
			content: string;
			written: boolean;
			path?: string;
	  }
	| { ok: false; error: string };

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
	summary: () => {
		agentTeamId: string;
		enabled: boolean;
		open: number;
		review: number;
		done: number;
		facts: number;
	};
	members: () => AgentTeamMember[];
	ledger?: () => AgentTeamLedgerEntry[];
	resolve: (taskId: string) => AgentTeamResolution | undefined;
	isLive?: (name: string) => boolean;
	/** False once the run is stopped; late board changes must not land. */
	canWork?: () => boolean;
	launch?: (input: AgentTeamLaunchInput, ctx: ExtensionContext) => Promise<AgentTeamLaunchResult>;
	round?: (input: AgentTeamRoundInput, ctx: ExtensionContext) => Promise<AgentTeamRoundResult>;
	startVerify?: (taskId: string, ctx: ExtensionContext) => void;
	startCrossVerify?: (taskId: string, ctx: ExtensionContext) => void;
	brief?: (
		question: string | undefined,
		ctx: ExtensionContext,
	) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
	promote?: (taskId: string, confirm: boolean) => AgentTeamPromoteResult;
	worktree?: (
		taskId: string,
		action: "status" | "merged" | "remove",
		ctx: ExtensionContext,
	) => { ok: true; text: string; task: AgentTeamTask } | { ok: false; error: string };
	advise?: (
		question: string,
		taskId: string | undefined,
		ctx: ExtensionContext,
	) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
	create: (
		input: {
			subject: string;
			description: string;
			blockedBy?: string[];
			writeScopes?: string[];
			acceptance?: string;
			verifyWith?: string;
			crossVerify?: boolean;
			isolation?: AgentTeamIsolation;
		},
		actor?: string,
	) => AgentTeamResult;
	update: (update: AgentTeamUpdate, caller: AgentTeamCaller) => AgentTeamResult;
	list: (filters: AgentTeamFilters) => AgentTeamTaskView[];
	get: (taskId: string) => AgentTeamTaskView | undefined;
}
