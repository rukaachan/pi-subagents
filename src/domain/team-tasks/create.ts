/**
 * pi-subagents: create one board task.
 */

import {
	MAX_AGENT_TEAM_ACCEPTANCE,
	MAX_AGENT_TEAM_BLOCKERS,
	MAX_AGENT_TEAM_DESCRIPTION,
	MAX_AGENT_TEAM_SUBJECT,
	MAX_AGENT_TEAM_TASKS,
	MAX_AGENT_TEAM_VERIFY_WITH,
	liveTasks,
	normalizeScopes,
	type AgentTeamBoard,
	type AgentTeamOrigin,
	type AgentTeamResult,
	type AgentTeamTask,
} from "../agent-team/index.ts";

export interface CreateAgentTeamTaskInput {
	subject: string;
	description: string;
	blockedBy?: string[];
	writeScopes?: string[];
	acceptance?: string;
	verifyWith?: string;
	origin?: AgentTeamOrigin;
}

function blockerError(
	board: AgentTeamBoard,
	taskId: string | undefined,
	blockedBy: readonly string[],
): string | undefined {
	if (blockedBy.length > MAX_AGENT_TEAM_BLOCKERS)
		return `At most ${MAX_AGENT_TEAM_BLOCKERS} blockers.`;
	const seen = new Set<string>();
	for (const id of blockedBy) {
		if (!id || seen.has(id)) return "Blockers must be distinct task ids.";
		seen.add(id);
		if (id === taskId) return "A task cannot block itself.";
		const found = board.tasks.find((row) => row.id === id);
		if (!found || found.status === "deleted") return `Unknown blocker "${id}".`;
	}
	return undefined;
}

export function createAgentTeamTask(
	board: AgentTeamBoard,
	input: CreateAgentTeamTaskInput,
	now = Date.now(),
): AgentTeamResult {
	if (liveTasks(board).length >= MAX_AGENT_TEAM_TASKS) {
		return { ok: false, error: `Agent team board is full (max ${MAX_AGENT_TEAM_TASKS} tasks).` };
	}
	const subject = input.subject.trim().slice(0, MAX_AGENT_TEAM_SUBJECT + 1);
	if (!subject) return { ok: false, error: "A task needs a subject." };
	if (subject.length > MAX_AGENT_TEAM_SUBJECT) {
		return { ok: false, error: `Subject is limited to ${MAX_AGENT_TEAM_SUBJECT} characters.` };
	}
	if (input.description.trim().length > MAX_AGENT_TEAM_DESCRIPTION) {
		return {
			ok: false,
			error: `Description is limited to ${MAX_AGENT_TEAM_DESCRIPTION} characters.`,
		};
	}
	const acceptance = input.acceptance?.trim();
	if (acceptance && acceptance.length > MAX_AGENT_TEAM_ACCEPTANCE) {
		return {
			ok: false,
			error: `Acceptance is limited to ${MAX_AGENT_TEAM_ACCEPTANCE} characters.`,
		};
	}
	const verifyWith = input.verifyWith?.trim();
	if (
		verifyWith &&
		(verifyWith.length > MAX_AGENT_TEAM_VERIFY_WITH || !/^[a-z0-9-_]+$/.test(verifyWith))
	) {
		return { ok: false, error: "verifyWith must be a subagent name." };
	}
	const blockedBy = [...new Set(input.blockedBy ?? [])];
	const blockers = blockerError(board, undefined, blockedBy);
	if (blockers) return { ok: false, error: blockers };
	const scopes = normalizeScopes(input.writeScopes ?? []);
	if (!scopes.ok) return scopes;
	const task: AgentTeamTask = {
		id: `task-${board.nextId}`,
		revision: 1,
		subject,
		description: input.description.trim().slice(0, MAX_AGENT_TEAM_DESCRIPTION),
		status: "pending",
		blockedBy,
		writeScopes: scopes.scopes,
		...(acceptance ? { acceptance } : {}),
		...(verifyWith ? { verifyWith } : {}),
		origin: input.origin ?? "manual",
		createdAt: now,
		updatedAt: now,
	};
	board.nextId += 1;
	board.tasks.push(task);
	return { ok: true, task };
}
