/**
 * pi-subagents: free tasks a run can no longer finish.
 */

import { MAX_AGENT_TEAM_ERROR, type AgentTeamBoard } from "./agent-team.ts";
import { recordAgentTeamAttempt } from "./agent-team-memory.ts";

/** Release in_progress tasks (all, or one owner's) back to pending. */
export function releaseTasks(
	board: AgentTeamBoard,
	owner: string | undefined,
	now: number,
	reason?: string,
): string[] {
	const lost = board.tasks.filter(
		(task) => task.status === "in_progress" && (owner === undefined || task.owner === owner),
	);
	const note = reason?.trim().slice(0, MAX_AGENT_TEAM_ERROR);
	for (const task of lost) {
		const claimed = task.owner;
		if (claimed) task.lastOwner = claimed;
		if (note) task.lastError = note;
		task.returnedAt = now;
		task.status = "pending";
		delete task.owner;
		recordAgentTeamAttempt(task, {
			at: now,
			...(claimed ? { owner: claimed } : {}),
			outcome: "released",
			...(note ? { error: note, method: note } : {}),
			...(task.round ? { round: task.round } : {}),
		});
		task.revision += 1;
		task.updatedAt = now;
	}
	return lost.map((task) => task.id);
}
