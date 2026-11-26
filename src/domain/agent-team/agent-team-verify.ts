/**
 * pi-subagents: accept or reject a task after review.
 */

import {
	MAX_AGENT_TEAM_FACT,
	MAX_AGENT_TEAM_NOTE,
	type AgentTeamBoard,
	type AgentTeamCaller,
	type AgentTeamResult,
	type AgentTeamTask,
	type AgentTeamUpdate,
} from "./agent-team.ts";
import { recordAgentTeamAttempt, recordAgentTeamLedgerEntry } from "./agent-team-memory.ts";

function fail(error: string): AgentTeamResult {
	return { ok: false, error };
}

/** Which gate still stands between this task and done. */
export function agentTeamGate(task: AgentTeamTask): "task" | "cross" | "done" {
	if (task.verdict !== "pass") return "task";
	if (task.crossVerify && task.crossVerdict !== "pass") return "cross";
	return "done";
}

function bump(task: AgentTeamTask, now: number): void {
	task.revision += 1;
	task.updatedAt = now;
}

export function verifyAgentTeamTask(
	board: AgentTeamBoard,
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
	const fact = update.fact?.trim();
	const excluded = update.excluded?.trim();
	if (fact && excluded) return fail("Send fact or excluded, not both.");
	if (fact && update.verdict !== "pass") return fail("A fact needs a passing verdict.");
	if (excluded && update.verdict !== "fail")
		return fail("An excluded note needs a failing verdict.");
	if (fact && fact.length > MAX_AGENT_TEAM_FACT) {
		return fail(`A fact is limited to ${MAX_AGENT_TEAM_FACT} characters.`);
	}
	if (excluded && excluded.length > MAX_AGENT_TEAM_FACT) {
		return fail(`A dead end is limited to ${MAX_AGENT_TEAM_FACT} characters.`);
	}
	if (update.scope === "cross") {
		if (!task.crossVerify) {
			return fail(`Task ${task.id} is not opted in to cross verification.`);
		}
		if (task.verdict !== "pass") {
			return fail("Cross verification needs the task verifier to pass first.");
		}
		if (task.crossVerdict) return fail(`Task ${task.id} already has a cross verdict.`);
		const owner = task.owner;
		task.crossVerdict = update.verdict;
		task.crossVerifiedBy = caller.name;
		task.crossVerifiedAt = now;
		if (update.verdict === "pass") {
			task.status = "completed";
			delete task.lastError;
			recordAgentTeamAttempt(task, {
				at: now,
				...(owner ? { owner } : {}),
				outcome: "passed",
				...(note ? { method: note } : {}),
				...(task.round ? { round: task.round } : {}),
			});
			if (fact) {
				recordAgentTeamLedgerEntry(
					board,
					{ text: fact, kind: "fact", taskId: task.id, by: caller.name },
					now,
				);
			}
		} else {
			task.lastOwner = task.owner ?? task.lastOwner;
			delete task.owner;
			task.status = "pending";
			task.lastError = note;
			recordAgentTeamAttempt(task, {
				at: now,
				...(owner ? { owner } : {}),
				outcome: "failed",
				...(note ? { error: note, method: note } : {}),
				...(task.round ? { round: task.round } : {}),
			});
			if (excluded) {
				recordAgentTeamLedgerEntry(
					board,
					{ text: excluded, kind: "excluded", taskId: task.id, by: caller.name },
					now,
				);
			}
		}
		bump(task, now);
		return { ok: true, task };
	}
	const owner = task.owner;
	task.verdict = update.verdict;
	task.verifiedBy = caller.name;
	task.verifiedAt = now;
	if (update.verdict === "pass") {
		task.status = task.crossVerify ? "in_review" : "completed";
		delete task.lastError;
		if (task.crossVerify) {
			delete task.crossVerdict;
			delete task.crossVerifiedBy;
			delete task.crossVerifiedAt;
			delete task.crossVerifyRunId;
		}
		recordAgentTeamAttempt(task, {
			at: now,
			...(owner ? { owner } : {}),
			outcome: "passed",
			...(note ? { method: note } : {}),
			...(task.round ? { round: task.round } : {}),
		});
		if (fact) {
			recordAgentTeamLedgerEntry(
				board,
				{ text: fact, kind: "fact", taskId: task.id, by: caller.name },
				now,
			);
		}
	} else {
		task.lastOwner = task.owner ?? task.lastOwner;
		delete task.owner;
		task.status = "pending";
		task.lastError = note;
		if (task.crossVerify) {
			delete task.crossVerdict;
			delete task.crossVerifiedBy;
			delete task.crossVerifiedAt;
			delete task.crossVerifyRunId;
		}
		recordAgentTeamAttempt(task, {
			at: now,
			...(owner ? { owner } : {}),
			outcome: "failed",
			...(note ? { error: note, method: note } : {}),
			...(task.round ? { round: task.round } : {}),
		});
		if (excluded) {
			recordAgentTeamLedgerEntry(
				board,
				{ text: excluded, kind: "excluded", taskId: task.id, by: caller.name },
				now,
			);
		}
	}
	bump(task, now);
	return { ok: true, task };
}
