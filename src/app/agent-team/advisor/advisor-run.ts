/**
 * pi-subagents: a fresh, read-only second opinion.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { discoverSubagents } from "../../../infra/files/index.ts";
import { withTemps } from "../../../domain/run/index.ts";
import type { ChildDeps } from "../../run/index.ts";
import type { SubagentConfig } from "../../../domain/subagent/index.ts";
import type { TaskStorePort } from "../../../domain/task/index.ts";
import { MAX_AGENT_TEAM_QUESTION } from "../../../domain/agent-team/index.ts";
import { journalWrite } from "../../../telemetry/journal/index.ts";
import { runSubagent } from "../../run/index.ts";
import { agentTeamSummary, getTask } from "../board/index.ts";

const ADVISOR_TIMEOUT_MS = 120_000;
let advising = false;

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

function fail(taskId: string | undefined, error: string): { ok: false; error: string } {
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
	_store: TaskStorePort,
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
	advising = true;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ADVISOR_TIMEOUT_MS);
	try {
		const disk = withTemps(discoverSubagents(ctx.cwd));
		const base = pick(disk.subagents);
		if (!base) return fail(taskId, "No advisor or planner subagent found.");
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
			controller.signal,
			undefined,
			undefined,
			[],
			{ agentTeamRole: "advisor", autoTask: false },
		);
		journalWrite({
			event: "agent_team_advice",
			chars: result.text.length,
			ok: true,
			...(taskId ? { taskId } : {}),
		});
		return { ok: true, text: result.text };
	} catch (err) {
		const error = controller.signal.aborted
			? "Advisor timed out after 120s."
			: err instanceof Error
				? err.message
				: String(err);
		return fail(taskId, error);
	} finally {
		clearTimeout(timer);
		advising = false;
	}
}
