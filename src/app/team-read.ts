/**
 * pi-subagents: read-only board views.
 */

import {
	MAX_TEAM_TASKS,
	liveTasks,
	teamView,
	type TeamBoard,
	type TeamFilters,
	type TeamTask,
	type TeamTaskView,
} from "../domain/team/index.ts";
import { scopeConflicts } from "../domain/team/index.ts";

export function resolveTaskOn(board: TeamBoard, taskId: string) {
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
	return { task: teamView(task, board), conflicts };
}

export function taskListOn(board: TeamBoard, filters: TeamFilters = {}): TeamTaskView[] {
	const rows = liveTasks(board).map((task) => teamView(task, board));
	const filtered = rows.filter((row) => {
		const task: TeamTask = row.task;
		if (filters.status && task.status !== filters.status) return false;
		if (filters.owner !== undefined && task.owner !== filters.owner) return false;
		if (filters.unowned !== undefined && (task.owner === undefined) !== filters.unowned)
			return false;
		if (filters.ready !== undefined && row.ready !== filters.ready) return false;
		return true;
	});
	const limit = Math.max(1, Math.min(MAX_TEAM_TASKS, filters.limit ?? MAX_TEAM_TASKS));
	return filtered.slice(0, limit);
}

export function summarizeBoard(
	board: TeamBoard,
	enabled: boolean,
): { teamId: string; enabled: boolean; open: number; done: number } {
	const rows: TeamTask[] = liveTasks(board);
	return {
		teamId: board.teamId,
		enabled,
		open: rows.filter((task) => task.status !== "completed").length,
		done: rows.filter((task) => task.status === "completed").length,
	};
}
