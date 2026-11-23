/**
 * pi-subagents: free team tasks that a run can no longer finish.
 */

import { releaseTasks } from "../domain/team-sweep.ts";
import { teamBoard, teamChanged, teamMembers } from "./team-store.ts";

export interface TaskSweep {
	released: string[];
	open: string[];
}

/**
 * After a run settles, free the tasks it owned. A failed or stopped run cannot
 * complete them, so leaving them claimed would strand the board.
 */
export function sweepMemberTasks(
	key: string | undefined,
	ok: boolean,
	now = Date.now(),
	reason?: string,
): TaskSweep {
	if (!key) return { released: [], open: [] };
	const member = teamMembers().find((row) => row.key === key);
	if (!member) return { released: [], open: [] };
	const board = teamBoard();
	const mine = board.tasks.filter(
		(task) => task.status === "in_progress" && task.owner === member.name,
	);
	if (mine.length === 0) return { released: [], open: [] };
	if (ok) return { released: [], open: mine.map((task) => task.id) };
	const released = releaseTasks(board, member.name, now, reason);
	teamChanged();
	return { released, open: [] };
}

/** A restart ends every run, so no task may stay claimed by a member that is gone. */
export function releaseOrphanedTasks(now = Date.now(), reason = "Pi restarted"): string[] {
	const released = releaseTasks(teamBoard(), undefined, now, reason);
	if (released.length > 0) teamChanged();
	return released;
}
