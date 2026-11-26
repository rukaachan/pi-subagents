/**
 * pi-subagents: start a cross-task verifier for one task.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { discoverSubagents } from "../../../infra/files/index.ts";
import { withTemps } from "../../../domain/run/index.ts";
import {
	MAX_AGENT_TEAM_SUBJECT,
	type AgentTeamBoard,
	type AgentTeamTask,
} from "../../../domain/agent-team/index.ts";
import { VERIFIER_BRIEF } from "../../../domain/policy/index.ts";
import type { TaskStorePort } from "../../../domain/task/index.ts";
import { launchBackground } from "../../run/index.ts";
import type { ChildDeps } from "../../run/index.ts";
import { agentTeamBoard, agentTeamEnabled, getTask, linkCrossVerifyRun } from "../board/index.ts";
import { pick } from "../verify-run/index.ts";
import { journalWrite } from "../../../telemetry/journal/index.ts";

const MAX_ROWS = 8;
const MAX_TEXT = 500;

function cut(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function rowText(task: AgentTeamTask): string {
	return `- ${task.id}: ${cut(task.subject, MAX_AGENT_TEAM_SUBJECT)} | acceptance: ${cut(task.acceptance ?? "(none)", MAX_TEXT)} | result: ${cut(task.result ?? "(none)", MAX_TEXT)}`;
}

export function crossPrompt(taskId: string, task: AgentTeamTask, board: AgentTeamBoard): string {
	const rows = board.tasks
		.filter(
			(row) => row.status === "in_review" && (task.round === undefined || row.round === task.round),
		)
		.slice(0, MAX_ROWS);
	return [
		`[agent-team] You are the cross-task verifier for board task ${taskId}: ${task.subject}`,
		"The rows below are context from the same round. Verify only this task against its acceptance and the repository; do not trust another row's verdict.",
		"Round rows:",
		...rows.map(rowText),
		VERIFIER_BRIEF,
		"Check the repository and run the smallest proof you need. Do not edit files or claim work.",
		`Call AgentTeam { action: "verify", task_id: "${taskId}", scope: "cross", expected_revision: <current>, verdict: "pass" | "fail", note: "short reason", fact: "one checked fact", excluded: "one dead end" }.`,
		"Send fact on pass or excluded on fail, never both.",
	].join("\n");
}

/** Launch the second reader; a missing verifier leaves the task in review. */
export function startAgentTeamCrossVerification(
	store: TaskStorePort,
	taskId: string,
	ctx: ExtensionContext,
	deps: ChildDeps,
): void {
	const view = getTask(taskId);
	if (!view || view.task.status !== "in_review") return;
	if (!view.task.crossVerify || view.task.verdict !== "pass" || view.task.crossVerdict) return;
	if (!agentTeamEnabled()) {
		journalWrite({
			event: "agent_team_verify",
			taskId,
			ok: false,
			error: "agent team is off",
			scope: "cross",
		});
		return;
	}
	const running = view.task.crossVerifyRunId ? store.get(view.task.crossVerifyRunId) : undefined;
	if (running?.status === "running") return;
	const disk = withTemps(discoverSubagents(ctx.cwd));
	const sub = pick(view.task.verifyWith, disk.subagents);
	if (!sub) {
		journalWrite({
			event: "agent_team_verify",
			taskId,
			ok: false,
			error: "no verifier subagent",
			scope: "cross",
		});
		return;
	}
	const runId = launchBackground(
		store,
		sub,
		`cross ${taskId}`,
		crossPrompt(taskId, view.task, agentTeamBoard()),
		ctx.cwd,
		ctx,
		deps,
		{
			kind: "background",
			agentTeamTaskId: taskId,
			agentTeamRole: "verifier",
			agentTeamOrigin: "task",
		},
	);
	linkCrossVerifyRun(taskId, runId);
	journalWrite({ event: "agent_team_verify", taskId, ok: true, runId, scope: "cross" });
}
