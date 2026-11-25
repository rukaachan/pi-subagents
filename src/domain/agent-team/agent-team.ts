/**
 * pi-subagents: the shared team task board.
 */

import { writeScopeWarnings } from "./agent-team-scope.ts";
import { canonicalWorkspacePath } from "../policy/index.ts";

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

/** One bounded note about a finished attempt. */
export interface AgentTeamAttempt {
	at: number;
	owner?: string;
	outcome: "released" | "failed" | "passed";
	error?: string;
}

/** A verified fact, or a dead end the team must not repeat. */
export interface AgentTeamLedgerEntry {
	text: string;
	kind: AgentTeamLedgerKind;
	taskId: string;
	by: string;
	at: number;
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
}

export interface AgentTeamMember {
	name: string;
	starter: string;
	role: AgentTeamRole;
	joinedAt: number;
	/** Stable run identity, so a retried attempt keeps its member name. */
	key?: string;
}

export interface AgentTeamFilters {
	status?: AgentTeamTaskStatus;
	owner?: string;
	unowned?: boolean;
	ready?: boolean;
	limit?: number;
}

export interface AgentTeamTaskView {
	task: AgentTeamTask;
	ready: boolean;
	blockedByOpen: string[];
	writeScopeWarnings: string[];
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
}

export type AgentTeamOk = { ok: true; task: AgentTeamTask; retriedFrom?: number };
export type AgentTeamFail = { ok: false; error: string };
export type AgentTeamResult = AgentTeamOk | AgentTeamFail;

export function newAgentTeam(agentTeamId: string): AgentTeamBoard {
	return { agentTeamId, nextId: 1, tasks: [], ledger: [] };
}

export function liveTasks(board: AgentTeamBoard): AgentTeamTask[] {
	return board.tasks.filter((task) => task.status !== "deleted");
}

function find(board: AgentTeamBoard, taskId: string): AgentTeamTask | undefined {
	return board.tasks.find((task) => task.id === taskId);
}

export function normalizeScopes(
	raw: readonly string[],
): { ok: true; scopes: string[] } | AgentTeamFail {
	if (raw.length > MAX_AGENT_TEAM_SCOPES) {
		return { ok: false, error: `At most ${MAX_AGENT_TEAM_SCOPES} write scopes.` };
	}
	const out: string[] = [];
	for (const item of raw) {
		const canonical = canonicalWorkspacePath(item);
		if (!canonical.ok) {
			const reason =
				canonical.error === "path is empty."
					? "cannot be empty."
					: canonical.error === 'path cannot contain "..".'
						? 'cannot contain "..".'
						: "must be workspace-relative.";
			return { ok: false, error: `Write scope "${item}" ${reason}` };
		}
		const scope = canonical.path;
		if (scope.length > 160)
			return { ok: false, error: "A write scope is limited to 160 characters." };
		if (!out.includes(scope)) out.push(scope);
	}
	return { ok: true, scopes: out };
}

function reaches(
	board: AgentTeamBoard,
	from: string,
	target: string,
	seen = new Set<string>(),
): boolean {
	if (from === target) return true;
	if (seen.has(from)) return false;
	seen.add(from);
	const task = find(board, from);
	for (const next of task?.blockedBy ?? []) {
		if (reaches(board, next, target, seen)) return true;
	}
	return false;
}

export function wouldCycle(
	board: AgentTeamBoard,
	taskId: string,
	blockedBy: readonly string[],
): boolean {
	return blockedBy.some((id) => reaches(board, id, taskId));
}

export function blockedByOpen(task: AgentTeamTask, board: AgentTeamBoard): string[] {
	return task.blockedBy.filter((id) => find(board, id)?.status !== "completed");
}

export function taskReady(task: AgentTeamTask, board: AgentTeamBoard): boolean {
	return task.status === "pending" && blockedByOpen(task, board).length === 0;
}

export function agentTeamView(task: AgentTeamTask, board: AgentTeamBoard): AgentTeamTaskView {
	return {
		task,
		ready: taskReady(task, board),
		blockedByOpen: blockedByOpen(task, board),
		writeScopeWarnings: writeScopeWarnings(task, board),
	};
}
