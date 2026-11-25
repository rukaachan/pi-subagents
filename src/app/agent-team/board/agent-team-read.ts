/**
 * pi-subagents: read-only board views.
 */

import {
	MAX_AGENT_TEAM_TASKS,
	ledgerCounts,
	liveTasks,
	agentTeamView,
	type AgentTeamBoard,
	type AgentTeamFilters,
	type AgentTeamTask,
	type AgentTeamTaskView,
} from "../../../domain/agent-team/index.ts";
import { scopeConflicts } from "../../../domain/agent-team/index.ts";

export function resolveTaskOn(board: AgentTeamBoard, taskId: string) {
	const task = board.tasks.find((row) => row.id === taskId);
	if (!task || task.status === "deleted") return undefined;
	const conflicts = scopeConflicts(task, board).flatMap((hit) => {
		const blocker = board.tasks.find((row) => row.id === hit.id);
		return blocker
			? [
					{
						...hit,
						scope: hit.reserved ?? hit.scope,
						revision: blocker.revision,
						status: blocker.status,
					},
				]
			: [];
	});
	return { task: agentTeamView(task, board), conflicts };
}

export function taskListOn(
	board: AgentTeamBoard,
	filters: AgentTeamFilters = {},
): AgentTeamTaskView[] {
	const rows = liveTasks(board).map((task) => agentTeamView(task, board));
	const filtered = rows.filter((row) => {
		const task: AgentTeamTask = row.task;
		if (filters.status && task.status !== filters.status) return false;
		if (filters.owner !== undefined && task.owner !== filters.owner) return false;
		if (filters.unowned !== undefined && (task.owner === undefined) !== filters.unowned)
			return false;
		if (filters.ready !== undefined && row.ready !== filters.ready) return false;
		return true;
	});
	const limit = Math.max(1, Math.min(MAX_AGENT_TEAM_TASKS, filters.limit ?? MAX_AGENT_TEAM_TASKS));
	return filtered.slice(0, limit);
}

export function summarizeBoard(
	board: AgentTeamBoard,
	enabled: boolean,
): {
	agentTeamId: string;
	enabled: boolean;
	open: number;
	review: number;
	done: number;
	facts: number;
} {
	const rows: AgentTeamTask[] = liveTasks(board);
	return {
		agentTeamId: board.agentTeamId,
		enabled,
		open: rows.filter((task) => task.status !== "completed").length,
		review: rows.filter((task) => task.status === "in_review").length,
		done: rows.filter((task) => task.status === "completed").length,
		facts: ledgerCounts(board).facts,
	};
}
