/**
 * pi-subagents: compare-and-set transitions on the team task board.
 */

import type {
	AgentTeamAction,
	AgentTeamBoard,
	AgentTeamCaller,
	AgentTeamMember,
	AgentTeamResult,
	AgentTeamUpdate,
} from "../agent-team/index.ts";
import { applyUpdate } from "./apply.ts";
const RETRY_SAFE = new Set<AgentTeamAction>([
	"claim",
	"release",
	"complete",
	"reopen",
	"reassign",
	"delete",
	"verify",
]);

/** Apply one CAS update, retrying once when the caller's revision is only stale. */
export function updateAgentTeamTask(
	board: AgentTeamBoard,
	update: AgentTeamUpdate,
	caller: AgentTeamCaller,
	members: readonly AgentTeamMember[],
	now = Date.now(),
): AgentTeamResult {
	const first = applyUpdate(board, update, caller, members, now);
	if (first.ok || !RETRY_SAFE.has(update.action)) return first;
	const task = board.tasks.find((row) => row.id === update.taskId);
	if (!task || task.status === "deleted" || task.revision <= update.expectedRevision) return first;
	const retried = applyUpdate(
		board,
		{ ...update, expectedRevision: task.revision },
		caller,
		members,
		now,
	);
	if (!retried.ok) return retried;
	return { ...retried, retriedFrom: update.expectedRevision };
}
