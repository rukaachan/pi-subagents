/**
 * pi-subagents: ask the advisor for a short round brief.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { discoverSubagents } from "../../../infra/files/index.ts";
import { withTemps } from "../../../domain/run/index.ts";
import { MAX_AGENT_TEAM_BRIEF, MAX_AGENT_TEAM_QUESTION } from "../../../domain/agent-team/index.ts";
import { MAX_LIVE_TASKS } from "../../../domain/task/index.ts";
import type { TaskStorePort } from "../../../domain/task/index.ts";
import { journalWrite } from "../../../telemetry/journal/index.ts";
import { launchBackground } from "../../run/index.ts";
import type { ChildDeps } from "../../run/index.ts";
import { readGlobalConfig } from "../../session/index.ts";
import { agentTeamSummary } from "../board/index.ts";
import { ADVISOR_TIMEOUT_MS, pick, readOnly } from "./advisor-run.ts";
import { waitForRunText } from "./wait.ts";

let briefing = false;

function fail(error: string): { ok: false; error: string } {
	journalWrite({
		event: "agent_team_brief",
		chars: 0,
		ok: false,
		error: error.slice(0, 200),
	});
	return { ok: false, error };
}

export async function briefAgentTeam(
	store: TaskStorePort,
	question: string | undefined,
	ctx: ExtensionContext,
	deps: ChildDeps,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
	const text = (question?.trim() || "Write a short brief for the next round.").slice(
		0,
		MAX_AGENT_TEAM_QUESTION + 1,
	);
	if (text.length > MAX_AGENT_TEAM_QUESTION) {
		return fail(`A brief question is limited to ${MAX_AGENT_TEAM_QUESTION} characters.`);
	}
	if (briefing) return fail("A brief is already running for this session.");
	const disk = withTemps(discoverSubagents(ctx.cwd));
	const base = pick(disk.subagents);
	if (!base) return fail("No advisor or planner subagent found.");
	const global = readGlobalConfig(ctx.cwd, undefined, {
		trusted: ctx.isProjectTrusted?.() === true,
	});
	const cap = global.liveCap ?? MAX_LIVE_TASKS;
	if (!store.canStart(cap)) return fail(`Live cap reached (${cap}); wait for a leg to finish.`);
	const summary = agentTeamSummary();
	const prompt = [
		`Agent team ${summary.agentTeamId}: ${summary.open} open, ${summary.review} review, ${summary.done} done.`,
		`Question: ${text}`,
		`Write a brief of at most ${MAX_AGENT_TEAM_BRIEF} characters: what is done, what is open, the main risk, and one next step. Do not edit files or claim work.`,
	].join("\n\n");
	briefing = true;
	try {
		const runId = launchBackground(store, readOnly(base), "brief", prompt, ctx.cwd, ctx, deps, {
			kind: "background",
			agentTeamRole: "advisor",
			agentTeamOrigin: "task",
		});
		const result = await waitForRunText(store, runId, ADVISOR_TIMEOUT_MS, "brief");
		if (!result.ok) return fail(result.error);
		const brief = result.text.slice(0, MAX_AGENT_TEAM_BRIEF);
		journalWrite({ event: "agent_team_brief", chars: brief.length, ok: true });
		return { ok: true, text: brief };
	} catch (err) {
		return fail(err instanceof Error ? err.message : String(err));
	} finally {
		briefing = false;
	}
}
