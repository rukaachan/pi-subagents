/**
 * pi-subagents: compare-and-set transitions on the team task board.
 */

import {
	LEAD_NAME,
	MAX_TEAM_BLOCKERS,
	MAX_TEAM_DESCRIPTION,
	MAX_TEAM_SUBJECT,
	blockedByOpen,
	normalizeScopes,
	taskReady,
	wouldCycle,
	type TeamAction,
	type TeamBoard,
	type TeamCaller,
	type TeamMember,
	type TeamResult,
	type TeamTask,
	type TeamUpdate,
} from "./team.ts";
import { scopeConflictError, scopeConflicts } from "./team-scope.ts";

function fail(error: string): TeamResult {
	return { ok: false, error };
}

function taskOf(board: TeamBoard, taskId: string): TeamTask | TeamResult {
	const task = board.tasks.find((row) => row.id === taskId);
	if (!task) return fail(`Unknown task "${taskId}".`);
	if (task.status === "deleted") return fail(`Task ${taskId} was deleted.`);
	return task;
}

function isResult(value: TeamTask | TeamResult): value is TeamResult {
	return "ok" in value;
}

function authorized(task: TeamTask, caller: TeamCaller): boolean {
	return caller.lead || task.owner === caller.name;
}

function bump(task: TeamTask, now: number): void {
	task.revision += 1;
	task.updatedAt = now;
}

const RETRY_SAFE = new Set<TeamAction>([
	"claim",
	"release",
	"complete",
	"reopen",
	"reassign",
	"delete",
]);

/** Apply one CAS update, retrying once when the caller's revision is only stale. */
export function updateTeamTask(
	board: TeamBoard,
	update: TeamUpdate,
	caller: TeamCaller,
	members: readonly TeamMember[],
	now = Date.now(),
): TeamResult {
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

function applyUpdate(
	board: TeamBoard,
	update: TeamUpdate,
	caller: TeamCaller,
	members: readonly TeamMember[],
	now: number,
): TeamResult {
	const found = taskOf(board, update.taskId);
	if (isResult(found)) return found;
	const task = found;
	if (task.revision !== update.expectedRevision) {
		return fail(
			`Task ${task.id} changed (revision ${task.revision}, expected ${update.expectedRevision}). Read it again.`,
		);
	}
	if (update.action === "reassign") {
		if (!caller.lead) return fail("Only the lead can reassign tasks.");
		if (task.status === "completed") return fail(`Task ${task.id} is completed; reopen it first.`);
		const owner = update.owner?.trim();
		if (owner) {
			if (owner !== LEAD_NAME && !members.some((member) => member.name === owner)) {
				const known = [LEAD_NAME, ...members.map((member) => member.name)].join(", ");
				return fail(`No member named "${owner}". Known: ${known}.`);
			}
			const hits = scopeConflicts(task, board);
			if (hits.length > 0) return fail(scopeConflictError(task, hits));
			task.owner = owner;
			task.status = "in_progress";
		} else {
			task.status = "pending";
			delete task.owner;
		}
		bump(task, now);
		return { ok: true, task };
	}
	if (update.action === "claim") {
		if (task.owner) return fail(`Task ${task.id} is owned by ${task.owner}.`);
		if (task.status !== "pending")
			return fail(`Task ${task.id} is ${task.status}; claim needs a pending task.`);
		const blocked = blockedByOpen(task, board);
		if (blocked.length > 0) return fail(`Task ${task.id} is blocked by ${blocked.join(", ")}.`);
		if (!taskReady(task, board)) return fail(`Task ${task.id} is not ready.`);
		const hits = scopeConflicts(task, board);
		if (hits.length > 0) return fail(scopeConflictError(task, hits));
		task.owner = caller.name;
		task.status = "in_progress";
		bump(task, now);
		return { ok: true, task };
	}
	if (!authorized(task, caller)) {
		const who = task.owner ?? "nobody";
		return fail(`Task ${task.id} is owned by ${who}. Only its owner or the lead can change it.`);
	}
	if (update.action === "release") {
		if (task.status !== "in_progress")
			return fail(`Task ${task.id} is ${task.status}; release needs an in-progress task.`);
		task.status = "pending";
		delete task.owner;
		bump(task, now);
		return { ok: true, task };
	}
	if (update.action === "complete") {
		if (task.status === "completed") return fail(`Task ${task.id} is already completed.`);
		task.status = "completed";
		bump(task, now);
		return { ok: true, task };
	}
	if (update.action === "reopen") {
		if (task.status !== "completed")
			return fail(`Task ${task.id} is ${task.status}; reopen needs a completed task.`);
		task.status = "pending";
		delete task.owner;
		bump(task, now);
		return { ok: true, task };
	}
	if (update.action === "delete") {
		const dependent = board.tasks.find(
			(row) => row.status !== "deleted" && row.id !== task.id && row.blockedBy.includes(task.id),
		);
		if (dependent) {
			return fail(`Task ${task.id} still blocks ${dependent.id}; clear that dependency first.`);
		}
		task.status = "deleted";
		delete task.owner;
		bump(task, now);
		return { ok: true, task };
	}
	if (update.action === "edit") {
		const subject = update.subject === undefined ? undefined : update.subject.trim();
		if (subject !== undefined) {
			if (!subject) return fail("A task needs a subject.");
			if (subject.length > MAX_TEAM_SUBJECT)
				return fail(`Subject is limited to ${MAX_TEAM_SUBJECT} characters.`);
		}
		if (
			update.description !== undefined &&
			update.description.trim().length > MAX_TEAM_DESCRIPTION
		) {
			return fail(`Description is limited to ${MAX_TEAM_DESCRIPTION} characters.`);
		}
		const scopes =
			update.writeScopes === undefined ? undefined : normalizeScopes(update.writeScopes);
		if (scopes && !scopes.ok) return scopes;
		const blockedBy = update.blockedBy === undefined ? undefined : [...new Set(update.blockedBy)];
		if (blockedBy) {
			if (blockedBy.length > MAX_TEAM_BLOCKERS)
				return fail(`At most ${MAX_TEAM_BLOCKERS} blockers.`);
			for (const id of blockedBy) {
				const blocker = board.tasks.find((row) => row.id === id);
				if (!blocker || blocker.status === "deleted") return fail(`Unknown blocker "${id}".`);
				if (id === task.id) return fail("A task cannot block itself.");
			}
		}
		if (
			subject === undefined &&
			update.description === undefined &&
			scopes === undefined &&
			blockedBy === undefined
		) {
			return fail("Edit needs a subject, description, write_scopes, or blocked_by.");
		}
		if (scopes?.ok && task.status === "in_progress") {
			const hits = scopeConflicts(task, board, scopes.scopes);
			if (hits.length > 0) return fail(scopeConflictError(task, hits, "change scopes"));
		}
		if (subject !== undefined) task.subject = subject;
		if (update.description !== undefined) task.description = update.description.trim();
		if (scopes?.ok) task.writeScopes = scopes.scopes;
		if (blockedBy) {
			const original = task.blockedBy;
			task.blockedBy = blockedBy;
			if (wouldCycle(board, task.id, blockedBy)) {
				task.blockedBy = original;
				return fail(`Dependencies for ${task.id} would create a cycle.`);
			}
		}
		bump(task, now);
		return { ok: true, task };
	}
	return fail(`Unsupported action "${update.action}".`);
}
