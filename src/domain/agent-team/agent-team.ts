/**
 * pi-subagents: the shared team task board.
 */

export const LEAD_NAME = "lead";
export const MAX_AGENT_TEAM_TASKS = 128;
export const MAX_AGENT_TEAM_MEMBERS = 32;
export const MAX_AGENT_TEAM_SUBJECT = 120;
export const MAX_AGENT_TEAM_DESCRIPTION = 2_000;
export const MAX_AGENT_TEAM_SCOPES = 20;
export const MAX_AGENT_TEAM_BLOCKERS = 20;
export const MAX_AGENT_TEAM_ERROR = 300;
export const MAX_AGENT_TEAM_RESULT = 2_000;
export const MAX_AGENT_TEAM_RUN_ID = 128;
export const MAX_AGENT_TEAM_ACCEPTANCE = 500;
export const MAX_AGENT_TEAM_NOTE = 300;
export const MAX_AGENT_TEAM_VERIFY_WITH = 64;
export const MAX_AGENT_TEAM_QUESTION = 1_000;
export const MAX_AGENT_TEAM_ATTEMPTS = 5;
export const MAX_AGENT_TEAM_FACT = 500;
export const MAX_AGENT_TEAM_FACTS = 50;
export const MAX_AGENT_TEAM_EXCLUDED = 20;
export const MAX_AGENT_TEAM_ROUNDS = 5;
export const MAX_AGENT_TEAM_ROUND_LEGS = 12;
export const DEFAULT_ROUND_TOKENS = 500_000;
export const DEFAULT_ROUND_MS = 1_800_000;
export const MAX_ROUND_TOKENS = 5_000_000;
export const MAX_ROUND_MS = 21_600_000;
export const MAX_AGENT_TEAM_BRIEF = 2_000;
export const MAX_AGENT_TEAM_METHOD = 300;
export const MAX_AGENT_TEAM_WORKTREE_PATH = 512;
export const MAX_AGENT_TEAM_PROMOTE = 4_000;

export type AgentTeamTaskStatus = "pending" | "in_progress" | "in_review" | "completed" | "deleted";
export type AgentTeamRole = "worker" | "verifier" | "advisor";
export type AgentTeamOrigin =
	| "manual"
	| "task"
	| "parallel"
	| "chain"
	| "delegate"
	| "finish"
	| "start";
export type VerificationVerdict = "pass" | "fail";
export type AgentTeamLedgerKind = "fact" | "excluded";
export type AgentTeamIsolation = "shared" | "worktree";

/** One bounded note about a finished attempt. */
export interface AgentTeamAttempt {
	at: number;
	owner?: string;
	outcome: "released" | "failed" | "passed";
	error?: string;
	/** How the attempt was tried; the release or verify note. */
	method?: string;
	/** The round that produced this attempt. */
	round?: number;
}

/** A verified fact, or a dead end the team must not repeat. */
export interface AgentTeamLedgerEntry {
	text: string;
	kind: AgentTeamLedgerKind;
	taskId: string;
	by: string;
	at: number;
}

/** One explicit batch opened by the lead. */
export interface AgentTeamRound {
	id: number;
	prompt: string;
	taskIds: string[];
	brief?: string;
	budget: { tokens: number; ms: number };
	startedAt: number;
}

/** One git worktree attached to a task. */
export interface AgentTeamWorktree {
	path: string;
	base: string;
	createdAt: number;
	mergedAt?: number;
}

export interface AgentTeamTask {
	id: string;
	revision: number;
	subject: string;
	description: string;
	status: AgentTeamTaskStatus;
	owner?: string;
	blockedBy: string[];
	writeScopes: string[];
	lastOwner?: string;
	lastError?: string;
	returnedAt?: number;
	/** The run this task's owner leg belongs to, when the board launched it. */
	runId?: string;
	/** What the owner reported when it completed the task. */
	result?: string;
	/** Criteria a verifier checks before the task may count as completed. */
	acceptance?: string;
	/** Subagent used for the fresh verification run; defaults to code-reviewer. */
	verifyWith?: string;
	verdict?: VerificationVerdict;
	verifiedBy?: string;
	verifiedAt?: number;
	verifyRunId?: string;
	/** A second reader checks every result in the same round. */
	crossVerify?: boolean;
	crossVerdict?: VerificationVerdict;
	crossVerifiedBy?: string;
	crossVerifiedAt?: number;
	crossVerifyRunId?: string;
	/** The round that opened this task. */
	round?: number;
	/** Shared workspace or an isolated git worktree. */
	isolation?: AgentTeamIsolation;
	worktree?: AgentTeamWorktree;
	origin?: AgentTeamOrigin;
	/** Oldest attempts drop out first; capped at MAX_AGENT_TEAM_ATTEMPTS. */
	attempts?: AgentTeamAttempt[];
	createdAt: number;
	updatedAt: number;
}

export interface AgentTeamBoard {
	agentTeamId: string;
	nextId: number;
	tasks: AgentTeamTask[];
	ledger: AgentTeamLedgerEntry[];
	rounds: AgentTeamRound[];
}

export interface AgentTeamMember {
	name: string;
	starter: string;
	role: AgentTeamRole;
	joinedAt: number;
	/** Stable run identity, so a retried attempt keeps its member name. */
	key?: string;
}

export type AgentTeamAction =
	| "claim"
	| "release"
	| "edit"
	| "complete"
	| "reopen"
	| "reassign"
	| "delete"
	| "verify";

export interface AgentTeamCaller {
	name: string;
	lead: boolean;
	role?: AgentTeamRole;
}

export interface AgentTeamUpdate {
	taskId: string;
	expectedRevision: number;
	action: AgentTeamAction;
	subject?: string;
	description?: string;
	blockedBy?: string[];
	writeScopes?: string[];
	owner?: string;
	/** Sent with complete; what the work returned. */
	result?: string;
	acceptance?: string;
	verifyWith?: string;
	verdict?: VerificationVerdict;
	note?: string;
	/** Reusable checked fact recorded on a passing verify. */
	fact?: string;
	/** Dead end recorded on a failing verify. */
	excluded?: string;
	/** Lead-only bypass of the verifier role; a note is required. */
	override?: boolean;
	/** Task or cross-task verification. */
	scope?: "task" | "cross";
	/** Opt in to the second reader. */
	crossVerify?: boolean;
	/** Shared workspace or an isolated git worktree. */
	isolation?: AgentTeamIsolation;
}

export type AgentTeamOk = { ok: true; task: AgentTeamTask; retriedFrom?: number };
export type AgentTeamFail = { ok: false; error: string };
export type AgentTeamResult = AgentTeamOk | AgentTeamFail;

export function newAgentTeam(agentTeamId: string): AgentTeamBoard {
	return { agentTeamId, nextId: 1, tasks: [], ledger: [], rounds: [] };
}

export function liveTasks(board: AgentTeamBoard): AgentTeamTask[] {
	return board.tasks.filter((task) => task.status !== "deleted");
}
