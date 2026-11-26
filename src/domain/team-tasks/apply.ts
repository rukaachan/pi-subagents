/**
 * pi-subagents: one compare-and-set board transition.
 */

import {
	LEAD_NAME,
	MAX_AGENT_TEAM_NOTE,
	MAX_AGENT_TEAM_RESULT,
	blockedByOpen,
	taskReady,
	type AgentTeamBoard,
	type AgentTeamCaller,
	type AgentTeamMember,
	type AgentTeamResult,
	type AgentTeamTask,
	type AgentTeamUpdate,
} from "../agent-team/index.ts";
import { scopeConflictError, scopeConflicts } from "../agent-team/index.ts";
import { recordAgentTeamAttempt, verifyAgentTeamTask } from "../agent-team/index.ts";
import { editAgentTeamTask } from "./edit.ts";

function fail(error: string): AgentTeamResult {
	return { ok: false, error };
}

function taskOf(board: AgentTeamBoard, taskId: string): AgentTeamTask | AgentTeamResult {
	const task = board.tasks.find((row) => row.id === taskId);
	if (!task) return fail(`Unknown task "${taskId}".`);
	if (task.status === "deleted") return fail(`Task ${taskId} was deleted.`);
	return task;
}

function isResult(value: AgentTeamTask | AgentTeamResult): value is AgentTeamResult {
	return "ok" in value;
}

function authorized(task: AgentTeamTask, caller: AgentTeamCaller): boolean {
	return caller.lead || task.owner === caller.name;
}

function bump(task: AgentTeamTask, now: number): void {
	task.revision += 1;
	task.updatedAt = now;
}

export function applyUpdate(
	board: AgentTeamBoard,
	update: AgentTeamUpdate,
	caller: AgentTeamCaller,
	members: readonly AgentTeamMember[],
	now: number,
): AgentTeamResult {
	const found = taskOf(board, update.taskId);
	if (isResult(found)) return found;
	const task = found;
	if (task.revision !== update.expectedRevision) {
		return fail(
			`Task ${task.id} changed (revision ${task.revision}, expected ${update.expectedRevision}). Read it again.`,
		);
	}
	if (update.action === "verify") return verifyAgentTeamTask(board, task, update, caller, now);
	if (update.action === "reassign") {
		if (!caller.lead) return fail("Only the lead can reassign tasks.");
		if (task.status === "completed") return fail(`Task ${task.id} is completed; reopen it first.`);
		if (task.status === "in_review") return fail(`Task ${task.id} is in review; verify it first.`);
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
		if (task.owner === caller.name && task.status === "in_progress") return { ok: true, task };
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
		const note = update.note?.trim();
		if (note && note.length > MAX_AGENT_TEAM_NOTE)
			return fail(`A release note is limited to ${MAX_AGENT_TEAM_NOTE} characters.`);
		const owner = task.owner;
		if (owner) task.lastOwner = owner;
		if (note) task.lastError = note;
		task.returnedAt = now;
		task.status = "pending";
		delete task.owner;
		recordAgentTeamAttempt(task, {
			at: now,
			...(owner ? { owner } : {}),
			outcome: "released",
			...(note ? { error: note, method: note } : {}),
			...(task.round ? { round: task.round } : {}),
		});
		bump(task, now);
		return { ok: true, task };
	}
	if (update.action === "complete") {
		if (task.status === "completed") return fail(`Task ${task.id} is already completed.`);
		if (task.status === "in_review") return fail(`Task ${task.id} is already in review.`);
		if (update.result !== undefined) {
			const result = update.result.trim();
			if (!result) return fail("A result cannot be empty when sent.");
			task.result = result.slice(0, MAX_AGENT_TEAM_RESULT);
		}
		task.status = task.acceptance ? "in_review" : "completed";
		bump(task, now);
		return { ok: true, task };
	}
	if (update.action === "reopen") {
		if (task.status !== "completed" && task.status !== "in_review")
			return fail(`Task ${task.id} is ${task.status}; reopen needs a completed or in-review task.`);
		task.status = "pending";
		delete task.owner;
		delete task.verdict;
		delete task.verifiedBy;
		delete task.verifiedAt;
		delete task.verifyRunId;
		delete task.crossVerdict;
		delete task.crossVerifiedBy;
		delete task.crossVerifiedAt;
		delete task.crossVerifyRunId;
		delete task.lastError;
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
	if (update.action === "edit") return editAgentTeamTask(board, task, update, now);
	return fail(`Unsupported action "${update.action}".`);
}
