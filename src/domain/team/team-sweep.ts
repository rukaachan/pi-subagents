/**
 * pi-subagents: free tasks a run can no longer finish.
 */

import { MAX_TEAM_ERROR, type TeamBoard } from "./team.ts";

/** Release in_progress tasks (all, or one owner's) back to pending. */
export function releaseTasks(
	board: TeamBoard,
	owner: string | undefined,
	now: number,
	reason?: string,
): string[] {
	const lost = board.tasks.filter(
		(task) => task.status === "in_progress" && (owner === undefined || task.owner === owner),
	);
	const note = reason?.trim().slice(0, MAX_TEAM_ERROR);
	for (const task of lost) {
		if (task.owner) task.lastOwner = task.owner;
		if (note) task.lastError = note;
		task.returnedAt = now;
		task.status = "pending";
		delete task.owner;
		task.revision += 1;
		task.updatedAt = now;
	}
	return lost.map((task) => task.id);
}
