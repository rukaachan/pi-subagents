/**
 * pi-subagents: a fresh, read-only second opinion.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { discoverSubagents } from "../../../infra/files/index.ts";
import { withTemps } from "../../../domain/run/index.ts";
import type { ChildDeps } from "../../run/index.ts";
import type { SubagentConfig } from "../../../domain/subagent/index.ts";
import { MAX_LIVE_TASKS } from "../../../domain/task/index.ts";
import type { TaskStorePort } from "../../../domain/task/index.ts";
import { MAX_AGENT_TEAM_QUESTION } from "../../../domain/agent-team/index.ts";
import { journalWrite } from "../../../telemetry/journal/index.ts";
import { launchBackground } from "../../run/index.ts";
import { readGlobalConfig } from "../../session/index.ts";
import { agentTeamSummary, getTask } from "../board/index.ts";
import { waitForRunText } from "./wait.ts";

export const ADVISOR_TIMEOUT_MS = 120_000;
let advising = false;

export function readOnly(sub: SubagentConfig): SubagentConfig {
	return {
		...sub,
		tools: ["read", "grep", "find", "ls"],
		paths: undefined,
		gates: false,
		mcp: false,
	};
}

export function pick(subs: readonly SubagentConfig[]): SubagentConfig | undefined {
	return subs.find((sub) => sub.name === "advisor") ?? subs.find((sub) => sub.name === "planner");
}

export function fail(taskId: string | undefined, error: string): { ok: false; error: string } {
	journalWrite({
		event: "agent_team_advice",
		chars: 0,
		ok: false,
		error: error.slice(0, 200),
		...(taskId ? { taskId } : {}),
	});
	return { ok: false, error };
}

export async function adviseAgentTeam(
	store: TaskStorePort,
	question: string,
	taskId: string | undefined,
	ctx: ExtensionContext,
	deps: ChildDeps,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
	const text = question.trim();
	if (!text) return fail(taskId, "advise needs question.");
	if (text.length > MAX_AGENT_TEAM_QUESTION) {
		return fail(taskId, `A question is limited to ${MAX_AGENT_TEAM_QUESTION} characters.`);
	}
	if (advising) return fail(taskId, "An advisor is already running for this session.");
	const disk = withTemps(discoverSubagents(ctx.cwd));
	const base = pick(disk.subagents);
	if (!base) return fail(taskId, "No advisor or planner subagent found.");
	const global = readGlobalConfig(ctx.cwd, undefined, {
		trusted: ctx.isProjectTrusted?.() === true,
	});
	const cap = global.liveCap ?? MAX_LIVE_TASKS;
	if (!store.canStart(cap)) {
		return fail(taskId, `Live cap reached (${cap}); wait for a leg to finish.`);
	}
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
	advising = true;
	try {
		const runId = launchBackground(store, readOnly(base), "advice", prompt, ctx.cwd, ctx, deps, {
			kind: "background",
			agentTeamRole: "advisor",
			agentTeamOrigin: "task",
		});
		const result = await waitForRunText(store, runId, ADVISOR_TIMEOUT_MS, "advisor");
		if (result.ok) {
			journalWrite({
				event: "agent_team_advice",
				chars: result.text.length,
				ok: true,
				...(taskId ? { taskId } : {}),
			});
		}
		return result;
	} catch (err) {
		return fail(taskId, err instanceof Error ? err.message : String(err));
	} finally {
		advising = false;
	}
}
