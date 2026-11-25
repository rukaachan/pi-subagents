/**
 * pi-subagents: a team start that is also a board.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ChildDeps } from "../../run/index.ts";
import { discoverSubagents } from "../../../infra/files/index.ts";
import {
	MAX_AGENT_TEAM_DESCRIPTION,
	MAX_AGENT_TEAM_MEMBERS,
	MAX_AGENT_TEAM_SUBJECT,
	MAX_AGENT_TEAM_TASKS,
} from "../../../domain/agent-team/index.ts";
import { withTemps } from "../../../domain/run/index.ts";
import type {
	AgentTeamLaunchInput,
	AgentTeamLaunchLeg,
	AgentTeamLaunchResult,
} from "../../../infra/agent-team/tools/index.ts";
import { startLaunch } from "../../launch/index.ts";
import {
	createTask,
	disableAgentTeam,
	enableAgentTeam,
	linkRun,
	agentTeamEnabled,
	agentTeamSummary,
	updateTask,
} from "../board/index.ts";
import type { TaskStorePort } from "../../../domain/task/index.ts";

function cut(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function rollback(tasks: readonly { taskId: string }[]): void {
	for (const task of tasks.toReversed()) {
		updateTask(
			{ taskId: task.taskId, expectedRevision: 1, action: "delete" },
			{ name: "lead", lead: true },
		);
	}
}

function legPrompt(taskId: string, prompt: string): string {
	return [
		`[agent-team] Board task ${taskId} is yours.`,
		`Run AgentAgentTeam { action: "get", task_id: "${taskId}" }, claim it with its current revision, do the work, then complete it.`,
		"If it is blocked, or another task overlaps its scopes, report it to the lead instead of widening.",
		prompt,
	].join("\n\n");
}

export async function startAgentTeamLaunch(
	store: TaskStorePort,
	input: AgentTeamLaunchInput,
	ctx: ExtensionContext,
	deps: ChildDeps,
): Promise<AgentTeamLaunchResult> {
	const prompt = input.prompt.trim();
	if (!prompt) return { ok: false, error: "AgentTeam start needs a prompt." };
	if (prompt.length > MAX_AGENT_TEAM_DESCRIPTION) {
		return {
			ok: false,
			error: `AgentTeam start prompt is limited to ${MAX_AGENT_TEAM_DESCRIPTION} characters.`,
		};
	}
	const disk = withTemps(discoverSubagents(ctx.cwd));
	const available = disk.subagents.map((sub) => sub.name);
	if (available.length === 0) {
		return { ok: false, error: `No subagents found. Add .md files to ${disk.userSubagentsDir}.` };
	}
	const requested = input.roster?.map((name) => name.trim()).filter(Boolean) ?? available;
	const roster = [...new Set(requested)];
	if (roster.length === 0) return { ok: false, error: "Pick at least one subagent." };
	if (roster.length > MAX_AGENT_TEAM_MEMBERS) {
		return { ok: false, error: `AgentTeam start takes at most ${MAX_AGENT_TEAM_MEMBERS} legs.` };
	}
	const missing = roster.filter((name) => !available.includes(name));
	if (missing.length > 0) {
		return {
			ok: false,
			error: `Unknown subagent${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.\nRoster: ${available.join(", ")}`,
		};
	}
	const summary = agentTeamSummary();
	if (summary.open + summary.done + roster.length > MAX_AGENT_TEAM_TASKS) {
		return { ok: false, error: `Agent team board is full (max ${MAX_AGENT_TEAM_TASKS} tasks).` };
	}
	const byName = new Map(disk.subagents.map((sub) => [sub.name, sub]));
	const wasEnabled = agentTeamEnabled();
	if (!wasEnabled) enableAgentTeam();
	const created: { name: string; taskId: string; scopes: string[] }[] = [];
	const undo = (error: string): AgentTeamLaunchResult => {
		rollback(created);
		if (!wasEnabled) disableAgentTeam();
		return { ok: false, error };
	};
	for (const name of roster) {
		const scopes = byName.get(name)?.paths ?? [];
		const result = createTask({
			subject: cut(`${name}: ${prompt}`, MAX_AGENT_TEAM_SUBJECT),
			description: prompt,
			...(scopes.length > 0 ? { writeScopes: scopes } : {}),
		});
		if (!result.ok) return undo(result.error);
		created.push({ name, taskId: result.task.id, scopes });
	}
	const prompts = created.map((task) => legPrompt(task.taskId, prompt));
	const started = startLaunch(store, "agent-team", roster, prompt, ctx, deps, {
		promptFor: (_name, index) => prompts[index] ?? prompt,
		// A queued leg gets its run id later; link it then, not just at handoff.
		onLeg: (index, runId) => {
			const task = created[index];
			if (task) linkRun(task.taskId, runId);
		},
	});
	if (!started.ok) return undo(started.error);
	const tasks: AgentTeamLaunchLeg[] = created.map((task, index) => {
		const runId = started.run.legs[index]?.taskId;
		return { name: task.name, taskId: task.taskId, ...(runId ? { runId } : {}) };
	});
	const unscoped = created.filter((task) => task.scopes.length === 0).map((task) => task.name);
	const warnings =
		unscoped.length > 0
			? [
					`no write scopes on ${unscoped.join(", ")}; parallel edits can collide. Add paths to those subagents or set scopes on the board.`,
				]
			: [];
	return {
		ok: true,
		agentTeamId: agentTeamSummary().agentTeamId,
		runId: started.run.runId,
		tasks,
		started: started.started,
		queued: started.queued,
		...(warnings.length > 0 ? { warnings } : {}),
	};
}
