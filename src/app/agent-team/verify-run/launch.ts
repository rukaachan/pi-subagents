/**
 * pi-subagents: start a fresh verifier for one task.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { discoverSubagents } from "../../../infra/files/index.ts";
import { withTemps } from "../../../domain/run/index.ts";
import { MAX_AGENT_TEAM_RESULT } from "../../../domain/agent-team/index.ts";
import { VERIFIER_BRIEF } from "../../../domain/policy/index.ts";
import type { SubagentConfig } from "../../../domain/subagent/index.ts";
import type { TaskStorePort } from "../../../domain/task/index.ts";
import { launchBackground } from "../../run/index.ts";
import type { ChildDeps } from "../../run/index.ts";
import { agentTeamEnabled, getTask, linkVerifyRun } from "../board/index.ts";
import { journalWrite } from "../../../telemetry/journal/index.ts";

export function verifierPrompt(
	taskId: string,
	task: { subject: string; acceptance?: string; result?: string; writeScopes: string[] },
): string {
	return [
		`Verify board task ${taskId}: ${task.subject}`,
		task.acceptance ? `Acceptance: ${task.acceptance}` : "Acceptance: (none recorded)",
		task.result
			? `Reported result: ${task.result.slice(0, MAX_AGENT_TEAM_RESULT)}`
			: "Reported result: (none)",
		task.writeScopes.length > 0
			? `Write scopes: ${task.writeScopes.join(", ")}`
			: "Write scopes: none",
		VERIFIER_BRIEF,
		"Check the repository and run the smallest proof you need. Do not edit files or claim work.",
		`Call AgentTeam { action: "verify", task_id: "${taskId}", expected_revision: <current>, verdict: "pass" | "fail", note: "short reason", fact: "one checked fact", excluded: "one dead end" }.`,
		"Send fact on pass or excluded on fail, never both; leave the other out.",
	].join("\n");
}

function pick(
	verifyWith: string | undefined,
	subs: readonly SubagentConfig[],
): SubagentConfig | undefined {
	const wanted = verifyWith ?? "code-reviewer";
	return subs.find((sub) => sub.name === wanted) ?? subs.find((sub) => sub.name === "tester");
}

/** Launch one verifier run; a missing verifier leaves the task in review. */
export function startAgentTeamVerification(
	store: TaskStorePort,
	taskId: string,
	ctx: ExtensionContext,
	deps: ChildDeps,
): void {
	const view = getTask(taskId);
	if (!view || view.task.status !== "in_review") return;
	if (!agentTeamEnabled()) {
		journalWrite({
			event: "agent_team_verify",
			taskId,
			ok: false,
			error: "agent team is off",
		});
		return;
	}
	const running = view.task.verifyRunId ? store.get(view.task.verifyRunId) : undefined;
	if (running?.status === "running") return;
	const disk = withTemps(discoverSubagents(ctx.cwd));
	const sub = pick(view.task.verifyWith, disk.subagents);
	if (!sub) {
		journalWrite({
			event: "agent_team_verify",
			taskId,
			ok: false,
			error: "no verifier subagent",
		});
		return;
	}
	const runId = launchBackground(
		store,
		sub,
		`verify ${taskId}`,
		verifierPrompt(taskId, view.task),
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
	linkVerifyRun(taskId, runId);
	journalWrite({ event: "agent_team_verify", taskId, ok: true, runId });
}
