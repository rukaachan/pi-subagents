/**
 * pi-subagents: board persistence and run links.
 */

import type { PersistedAgentTeam } from "../../../infra/state/index.ts";
import type { AgentTeamWorktree } from "../../../domain/agent-team/index.ts";
import {
	agentTeamChanged,
	hasAgentTeamState,
	readAgentTeamState,
	writeAgentTeamState,
} from "./agent-team-store.ts";

/** Attach the run that owns a task, without touching its revision. */
export function linkRun(taskId: string, runId: string): void {
	const task = readAgentTeamState().board.tasks.find((row) => row.id === taskId);
	if (!task || task.status === "deleted") return;
	const clean = runId.trim().slice(0, 128);
	if (!clean || task.runId === clean) return;
	task.runId = clean;
	agentTeamChanged();
}

export function linkVerifyRun(taskId: string, runId: string): void {
	const task = readAgentTeamState().board.tasks.find((row) => row.id === taskId);
	if (!task || task.status === "deleted") return;
	const clean = runId.trim().slice(0, 128);
	if (!clean || task.verifyRunId === clean) return;
	task.verifyRunId = clean;
	agentTeamChanged();
}

export function linkCrossVerifyRun(taskId: string, runId: string): void {
	const task = readAgentTeamState().board.tasks.find((row) => row.id === taskId);
	if (!task || task.status === "deleted") return;
	const clean = runId.trim().slice(0, 128);
	if (!clean || task.crossVerifyRunId === clean) return;
	task.crossVerifyRunId = clean;
	agentTeamChanged();
}

export function setTaskWorktree(taskId: string, worktree: AgentTeamWorktree): void {
	const task = readAgentTeamState().board.tasks.find((row) => row.id === taskId);
	if (!task || task.status === "deleted") return;
	task.worktree = { ...worktree };
	agentTeamChanged();
}

export function markTaskWorktreeMerged(taskId: string, at: number): void {
	const task = readAgentTeamState().board.tasks.find((row) => row.id === taskId);
	if (!task?.worktree) return;
	task.worktree.mergedAt = at;
	agentTeamChanged();
}

export function clearTaskWorktree(taskId: string): void {
	const task = readAgentTeamState().board.tasks.find((row) => row.id === taskId);
	if (!task) return;
	delete task.worktree;
	agentTeamChanged();
}

export function agentTeamSnapshot(): PersistedAgentTeam | undefined {
	if (!hasAgentTeamState()) return undefined;
	const state = readAgentTeamState();
	return {
		agentTeamId: state.board.agentTeamId,
		enabled: state.enabled,
		nextId: state.board.nextId,
		tasks: state.board.tasks.map((task) => ({
			...task,
			blockedBy: [...task.blockedBy],
			writeScopes: [...task.writeScopes],
			...(task.attempts ? { attempts: task.attempts.map((attempt) => ({ ...attempt })) } : {}),
			...(task.worktree ? { worktree: { ...task.worktree } } : {}),
		})),
		members: state.members.map((member) => ({ ...member })),
		ledger: state.board.ledger.map((entry) => ({ ...entry })),
		rounds: state.board.rounds.map((round) => ({
			...round,
			taskIds: [...round.taskIds],
			budget: { ...round.budget },
		})),
	};
}

export function restoreAgentTeam(snapshot: PersistedAgentTeam): void {
	writeAgentTeamState({
		enabled: snapshot.enabled,
		board: {
			agentTeamId: snapshot.agentTeamId,
			nextId: snapshot.nextId,
			tasks: snapshot.tasks,
			ledger: snapshot.ledger,
			rounds: snapshot.rounds,
		},
		members: snapshot.members,
	});
}
