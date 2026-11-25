/**
 * pi-subagents: a fresh, read-only second opinion.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { discoverSubagents } from "../../../infra/files/index.ts";
import { withTemps } from "../../../domain/run/index.ts";
import type { ChildDeps } from "../../run/index.ts";
import type { SubagentConfig } from "../../../domain/subagent/index.ts";
import type { TaskStorePort } from "../../../domain/task/index.ts";
import { runSubagent } from "../../run/index.ts";
import { agentTeamSummary, getTask } from "../board/index.ts";

function readOnly(sub: SubagentConfig): SubagentConfig {
	return {
		...sub,
		tools: ["read", "grep", "find", "ls"],
		paths: undefined,
		gates: false,
		mcp: false,
	};
}

function pick(subs: readonly SubagentConfig[]): SubagentConfig | undefined {
	return subs.find((sub) => sub.name === "advisor") ?? subs.find((sub) => sub.name === "planner");
}

export async function adviseAgentTeam(
	_store: TaskStorePort,
	question: string,
	taskId: string | undefined,
	ctx: ExtensionContext,
	deps: ChildDeps,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
	const text = question.trim();
	if (!text) return { ok: false, error: "advise needs question." };
	const disk = withTemps(discoverSubagents(ctx.cwd));
	const base = pick(disk.subagents);
	if (!base) return { ok: false, error: "No advisor or planner subagent found." };
	const summary = agentTeamSummary();
	const task = taskId ? getTask(taskId) : undefined;
	const prompt = [
		`Agent team ${summary.agentTeamId}: ${summary.open} open, ${summary.review} review, ${summary.done} done.`,
		task
			? `Task ${task.task.id} [${task.task.status}] ${task.task.subject}\n${task.task.description}`
			: "No task named.",
		`Question: ${text}`,
		"Answer with a short recommendation and the main trade-off. Do not edit files or claim work.",
	].join("\n\n");
	const result = await runSubagent(
		readOnly(base),
		prompt,
		ctx.cwd,
		ctx,
		deps,
		undefined,
		undefined,
		undefined,
		[],
		{ agentTeamRole: "advisor", autoTask: false },
	);
	return { ok: true, text: result.text };
}
