/**
 * pi-subagents: accept or reject a task after review.
 */

import {
	MAX_AGENT_TEAM_NOTE,
	type AgentTeamCaller,
	type AgentTeamResult,
	type AgentTeamTask,
	type AgentTeamUpdate,
} from "./agent-team.ts";

function fail(error: string): AgentTeamResult {
	return { ok: false, error };
}

function bump(task: AgentTeamTask, now: number): void {
	task.revision += 1;
	task.updatedAt = now;
}

export function verifyAgentTeamTask(
	task: AgentTeamTask,
	update: AgentTeamUpdate,
	caller: AgentTeamCaller,
	now: number,
): AgentTeamResult {
	if (task.status !== "in_review") {
		return fail(`Task ${task.id} is ${task.status}; verify needs an in-review task.`);
	}
	if (update.verdict !== "pass" && update.verdict !== "fail") {
		return fail("verify needs verdict pass or fail.");
	}
	const override = caller.lead && update.override === true;
	if (!override && caller.role !== "verifier") {
		return fail("Only a verifier or the lead can verify a task.");
	}
	const note = update.note?.trim();
	if (note && note.length > MAX_AGENT_TEAM_NOTE) {
		return fail(`A verification note is limited to ${MAX_AGENT_TEAM_NOTE} characters.`);
	}
	if (update.verdict === "fail" && !note) {
		return fail("A failed verification needs a note.");
	}
	if (override && !note) {
		return fail("A lead override needs a note.");
	}
	task.verdict = update.verdict;
	task.verifiedBy = caller.name;
	task.verifiedAt = now;
	if (update.verdict === "pass") {
		task.status = "completed";
		delete task.lastError;
	} else {
		task.lastOwner = task.owner ?? task.lastOwner;
		delete task.owner;
		task.status = "pending";
		task.lastError = note;
	}
	bump(task, now);
	return { ok: true, task };
}
