/**
 * pi-subagents: edit one board task.
 */

import {
	MAX_AGENT_TEAM_ACCEPTANCE,
	MAX_AGENT_TEAM_BLOCKERS,
	MAX_AGENT_TEAM_DESCRIPTION,
	MAX_AGENT_TEAM_SUBJECT,
	MAX_AGENT_TEAM_VERIFY_WITH,
	normalizeScopes,
	wouldCycle,
	type AgentTeamBoard,
	type AgentTeamResult,
	type AgentTeamTask,
	type AgentTeamUpdate,
} from "../agent-team/index.ts";
import { scopeConflictError, scopeConflicts } from "../agent-team/index.ts";

function fail(error: string): AgentTeamResult {
	return { ok: false, error };
}

function bump(task: AgentTeamTask, now: number): void {
	task.revision += 1;
	task.updatedAt = now;
}

export function editAgentTeamTask(
	board: AgentTeamBoard,
	task: AgentTeamTask,
	update: AgentTeamUpdate,
	now: number,
): AgentTeamResult {
	const subject = update.subject === undefined ? undefined : update.subject.trim();
	if (subject !== undefined) {
		if (!subject) return fail("A task needs a subject.");
		if (subject.length > MAX_AGENT_TEAM_SUBJECT)
			return fail(`Subject is limited to ${MAX_AGENT_TEAM_SUBJECT} characters.`);
	}
	if (
		update.description !== undefined &&
		update.description.trim().length > MAX_AGENT_TEAM_DESCRIPTION
	) {
		return fail(`Description is limited to ${MAX_AGENT_TEAM_DESCRIPTION} characters.`);
	}
	const acceptance = update.acceptance === undefined ? undefined : update.acceptance.trim();
	if (acceptance && acceptance.length > MAX_AGENT_TEAM_ACCEPTANCE) {
		return fail(`Acceptance is limited to ${MAX_AGENT_TEAM_ACCEPTANCE} characters.`);
	}
	const verifyWith = update.verifyWith === undefined ? undefined : update.verifyWith.trim();
	if (
		verifyWith &&
		(verifyWith.length > MAX_AGENT_TEAM_VERIFY_WITH || !/^[a-z0-9-_]+$/.test(verifyWith))
	) {
		return fail("verifyWith must be a subagent name.");
	}
	const scopes = update.writeScopes === undefined ? undefined : normalizeScopes(update.writeScopes);
	if (scopes && !scopes.ok) return scopes;
	const blockedBy = update.blockedBy === undefined ? undefined : [...new Set(update.blockedBy)];
	if (blockedBy) {
		if (blockedBy.length > MAX_AGENT_TEAM_BLOCKERS)
			return fail(`At most ${MAX_AGENT_TEAM_BLOCKERS} blockers.`);
		for (const id of blockedBy) {
			const blocker = board.tasks.find((row) => row.id === id);
			if (!blocker || blocker.status === "deleted") return fail(`Unknown blocker "${id}".`);
			if (id === task.id) return fail("A task cannot block itself.");
		}
	}
	if (
		update.isolation !== undefined &&
		update.isolation !== "shared" &&
		update.isolation !== "worktree"
	) {
		return fail("Isolation must be shared or worktree.");
	}
	if (update.isolation !== undefined && task.status !== "pending") {
		return fail("Isolation can change only while the task is pending.");
	}
	if (update.isolation === "shared" && task.worktree) {
		return fail("Remove the worktree before sharing the workspace.");
	}
	const nextAcceptance = update.acceptance === undefined ? task.acceptance : acceptance;
	if (
		(update.crossVerify === true || (update.acceptance !== undefined && !acceptance)) &&
		!nextAcceptance
	) {
		return fail("Cross verification needs acceptance.");
	}
	if (
		subject === undefined &&
		update.description === undefined &&
		scopes === undefined &&
		blockedBy === undefined &&
		update.acceptance === undefined &&
		update.verifyWith === undefined &&
		update.crossVerify === undefined &&
		update.isolation === undefined
	) {
		return fail(
			"Edit needs a subject, description, write_scopes, blocked_by, acceptance, verify_with, or cross_verify.",
		);
	}
	if (scopes?.ok && task.status === "in_progress") {
		const hits = scopeConflicts(task, board, scopes.scopes);
		if (hits.length > 0) return fail(scopeConflictError(task, hits, "change scopes"));
	}
	if (subject !== undefined) task.subject = subject;
	if (update.description !== undefined) task.description = update.description.trim();
	if (scopes?.ok) task.writeScopes = scopes.scopes;
	if (update.acceptance !== undefined) {
		if (acceptance) task.acceptance = acceptance;
		else delete task.acceptance;
	}
	if (update.verifyWith !== undefined) {
		if (verifyWith) task.verifyWith = verifyWith;
		else delete task.verifyWith;
	}
	if (update.isolation !== undefined) {
		if (update.isolation === "worktree") task.isolation = "worktree";
		else delete task.isolation;
	}
	if (update.crossVerify !== undefined) {
		if (update.crossVerify) task.crossVerify = true;
		else {
			delete task.crossVerify;
			delete task.crossVerdict;
			delete task.crossVerifiedBy;
			delete task.crossVerifiedAt;
			delete task.crossVerifyRunId;
		}
	}
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
