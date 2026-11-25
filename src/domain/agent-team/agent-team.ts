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

export type AgentTeamTaskStatus = "pending" | "in_progress" | "completed" | "deleted";

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
	createdAt: number;
	updatedAt: number;
}

export interface AgentTeamBoard {
	agentTeamId: string;
	nextId: number;
	tasks: AgentTeamTask[];
}

export interface AgentTeamMember {
	name: string;
	starter: string;
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
	| "delete";

export interface AgentTeamCaller {
	name: string;
	lead: boolean;
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
}

export type AgentTeamOk = { ok: true; task: AgentTeamTask; retriedFrom?: number };
export type AgentTeamFail = { ok: false; error: string };
export type AgentTeamResult = AgentTeamOk | AgentTeamFail;

export function newAgentTeam(agentTeamId: string): AgentTeamBoard {
	return { agentTeamId, nextId: 1, tasks: [] };
}

export function liveTasks(board: AgentTeamBoard): AgentTeamTask[] {
	return board.tasks.filter((task) => task.status !== "deleted");
}

function find(board: AgentTeamBoard, taskId: string): AgentTeamTask | undefined {
	return board.tasks.find((task) => task.id === taskId);
}

function text(value: string, max: number): string {
	return value.trim().slice(0, max);
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

function blockerError(
	board: AgentTeamBoard,
	taskId: string | undefined,
	blockedBy: readonly string[],
): string | undefined {
	if (blockedBy.length > MAX_AGENT_TEAM_BLOCKERS)
		return `At most ${MAX_AGENT_TEAM_BLOCKERS} blockers.`;
	const seen = new Set<string>();
	for (const id of blockedBy) {
		if (!id || seen.has(id)) return "Blockers must be distinct task ids.";
		seen.add(id);
		if (id === taskId) return "A task cannot block itself.";
		const found = find(board, id);
		if (!found || found.status === "deleted") return `Unknown blocker "${id}".`;
	}
	return undefined;
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

export function createAgentTeamTask(
	board: AgentTeamBoard,
	input: { subject: string; description: string; blockedBy?: string[]; writeScopes?: string[] },
	now = Date.now(),
): AgentTeamResult {
	if (liveTasks(board).length >= MAX_AGENT_TEAM_TASKS) {
		return { ok: false, error: `Agent team board is full (max ${MAX_AGENT_TEAM_TASKS} tasks).` };
	}
	const subject = text(input.subject, MAX_AGENT_TEAM_SUBJECT + 1);
	if (!subject) return { ok: false, error: "A task needs a subject." };
	if (subject.length > MAX_AGENT_TEAM_SUBJECT) {
		return { ok: false, error: `Subject is limited to ${MAX_AGENT_TEAM_SUBJECT} characters.` };
	}
	if (input.description.trim().length > MAX_AGENT_TEAM_DESCRIPTION) {
		return {
			ok: false,
			error: `Description is limited to ${MAX_AGENT_TEAM_DESCRIPTION} characters.`,
		};
	}
	const blockedBy = [...new Set(input.blockedBy ?? [])];
	const blockers = blockerError(board, undefined, blockedBy);
	if (blockers) return { ok: false, error: blockers };
	const scopes = normalizeScopes(input.writeScopes ?? []);
	if (!scopes.ok) return scopes;
	const task: AgentTeamTask = {
		id: `task-${board.nextId}`,
		revision: 1,
		subject,
		description: input.description.trim().slice(0, MAX_AGENT_TEAM_DESCRIPTION),
		status: "pending",
		blockedBy,
		writeScopes: scopes.scopes,
		createdAt: now,
		updatedAt: now,
	};
	board.nextId += 1;
	board.tasks.push(task);
	return { ok: true, task };
}
