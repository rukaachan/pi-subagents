/**
 * pi-subagents: put a launched leg on the board.
 */

import {
	MAX_AGENT_TEAM_SUBJECT,
	ledgerPrompt,
	type AgentTeamOrigin,
	type AgentTeamRole,
} from "../../../domain/agent-team/index.ts";
import type { SubagentConfig } from "../../../domain/subagent/index.ts";
import { VERIFIER_BRIEF } from "../../../domain/policy/index.ts";
import {
	agentTeamBoard,
	agentTeamEnabled,
	createTask,
	getTask,
	hasAgentTeamState,
	linkRun,
	updateTask,
} from "../board/index.ts";

export interface EnsureTaskInput {
	sub: SubagentConfig;
	prompt: string;
	origin: AgentTeamOrigin;
	runId?: string;
	blockedBy?: string[];
	existingTaskId?: string;
	member?: string;
}

export type EnsureTaskResult = { ok: true; taskId?: string } | { ok: false; error: string };

function subject(sub: SubagentConfig, prompt: string): string {
	const line = prompt.replace(/\s+/g, " ").trim();
	const text = `${sub.name}: ${line}`;
	return text.length <= MAX_AGENT_TEAM_SUBJECT
		? text
		: `${text.slice(0, MAX_AGENT_TEAM_SUBJECT - 1)}…`;
}

function assign(taskId: string, member: string): string | undefined {
	const view = getTask(taskId);
	if (!view) return `Board task ${taskId} disappeared.`;
	if (view.task.status !== "pending" && view.task.status !== "in_progress") return undefined;
	if (view.task.owner === member) return undefined;
	if (view.task.owner) return undefined;
	const result = updateTask(
		{
			taskId,
			expectedRevision: view.task.revision,
			action: "reassign",
			owner: member,
		},
		{ name: "lead", lead: true },
	);
	return result.ok ? undefined : result.error;
}

/** Create or reuse the task for one work leg. Off means no new task. */
export function ensureTask(input: EnsureTaskInput): EnsureTaskResult {
	let taskId = input.existingTaskId;
	if (taskId) {
		const view = getTask(taskId);
		if (!view || view.task.status === "deleted" || view.task.status === "completed")
			taskId = undefined;
	}
	if (!taskId && agentTeamEnabled()) {
		const referenced = input.prompt.match(/\btask-[A-Za-z0-9_-]+\b/)?.[0];
		const view = referenced ? getTask(referenced) : undefined;
		if (view && view.task.status !== "completed" && view.task.status !== "deleted")
			taskId = view.task.id;
	}
	if (!taskId) {
		if (!agentTeamEnabled()) return { ok: true };
		const created = createTask(
			{
				subject: subject(input.sub, input.prompt),
				description: input.prompt,
				...(input.blockedBy && input.blockedBy.length > 0 ? { blockedBy: input.blockedBy } : {}),
				...(input.sub.paths && input.sub.paths.length > 0 ? { writeScopes: input.sub.paths } : {}),
				origin: input.origin,
			},
			"lead",
		);
		if (!created.ok) return { ok: false, error: created.error };
		taskId = created.task.id;
	}
	if (input.runId) linkRun(taskId, input.runId);
	if (input.member) {
		const error = assign(taskId, input.member);
		if (error) return { ok: false, error };
	}
	return { ok: true, taskId };
}

export function taskPrompt(taskId: string, role: AgentTeamRole = "worker"): string {
	if (role === "verifier") {
		return [
			`[agent-team] You are the verifier for board task ${taskId}.`,
			VERIFIER_BRIEF,
			`Read it, check its acceptance text against the result and the repository, then call AgentTeam { action: "verify", task_id: "${taskId}", expected_revision: <current>, verdict: "pass" | "fail", note: "...", fact: "...", excluded: "..." }.`,
			"Send fact on pass or excluded on fail, never both. Do not edit files or claim work.",
		].join("\n");
	}
	if (role === "advisor") {
		return `[agent-team] You are the advisor for this team. Answer the lead's question. Do not edit files, claim tasks, or verify work.`;
	}
	const facts = hasAgentTeamState() && agentTeamEnabled() ? ledgerPrompt(agentTeamBoard()) : "";
	const head = `[agent-team] Board task ${taskId} is yours. Run AgentTeam { action: "get", task_id: "${taskId}" }, claim it with its current revision, do the work, then complete it.`;
	return facts ? `${head}\n${facts}` : head;
}

export function completeTask(taskId: string, result?: string): void {
	const view = getTask(taskId);
	if (!view) return;
	if (view.task.status !== "pending" && view.task.status !== "in_progress") return;
	updateTask(
		{
			taskId,
			expectedRevision: view.task.revision,
			action: "complete",
			...(result ? { result } : {}),
		},
		{ name: "lead", lead: true },
	);
}

export function releaseTask(taskId: string, note: string): void {
	const view = getTask(taskId);
	if (!view || view.task.status !== "in_progress") return;
	updateTask(
		{ taskId, expectedRevision: view.task.revision, action: "release", note },
		{ name: "lead", lead: true },
	);
}
