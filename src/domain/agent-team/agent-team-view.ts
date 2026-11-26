/**
 * pi-subagents: board views and dependency checks.
 */

import { writeScopeWarnings } from "./agent-team-scope.ts";
import { canonicalWorkspacePath } from "../policy/index.ts";
import {
	MAX_AGENT_TEAM_SCOPES,
	type AgentTeamBoard,
	type AgentTeamFail,
	type AgentTeamTask,
	type AgentTeamTaskStatus,
} from "./agent-team.ts";

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
