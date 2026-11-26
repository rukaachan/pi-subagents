/**
 * pi-subagents: inspect and retire one task worktree.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { removeWorktree, worktreeState } from "../../../infra/worktree/index.ts";
import type { AgentTeamTask } from "../../../domain/agent-team/index.ts";
import { journalWrite } from "../../../telemetry/journal/index.ts";
import { clearTaskWorktree, getTask, markTaskWorktreeMerged } from "../board/index.ts";

export type AgentTeamWorktreeAction = "status" | "merged" | "remove";

export type AgentTeamWorktreeResult =
	| { ok: true; text: string; task: AgentTeamTask }
	| { ok: false; error: string };

function fail(
	taskId: string,
	action: AgentTeamWorktreeAction,
	error: string,
): AgentTeamWorktreeResult {
	journalWrite({
		event: "agent_team_worktree",
		taskId,
		action,
		ok: false,
		error: error.slice(0, 200),
	});
	return { ok: false, error };
}

export function worktreeAction(
	taskId: string,
	action: AgentTeamWorktreeAction,
	ctx: ExtensionContext,
): AgentTeamWorktreeResult {
	const view = getTask(taskId);
	if (!view) return fail(taskId, action, `Unknown task "${taskId}".`);
	const worktree = view.task.worktree;
	if (!worktree) return fail(taskId, action, `Task ${taskId} has no worktree.`);
	if (action === "status") {
		const state = worktreeState(worktree.path);
		const merged = worktree.mergedAt ? " · merged" : "";
		const text = `${worktree.path} · ${state}${merged}`;
		journalWrite({
			event: "agent_team_worktree",
			taskId,
			action,
			ok: true,
			path: worktree.path,
		});
		return { ok: true, text, task: view.task };
	}
	if (action === "merged") {
		if (worktree.mergedAt) return fail(taskId, action, "Worktree is already marked merged.");
		if (worktreeState(worktree.path) !== "clean") {
			return fail(
				taskId,
				action,
				"Worktree has uncommitted changes; keep it or remove it explicitly.",
			);
		}
		const removed = removeWorktree(ctx.cwd, worktree.path, false);
		if (!removed.ok) return fail(taskId, action, removed.error);
		markTaskWorktreeMerged(taskId, Date.now());
		journalWrite({
			event: "agent_team_worktree",
			taskId,
			action,
			ok: true,
			path: worktree.path,
		});
		return {
			ok: true,
			text: `Removed merged worktree ${worktree.path}.`,
			task: getTask(taskId)?.task ?? view.task,
		};
	}
	const removed = removeWorktree(ctx.cwd, worktree.path, true);
	if (!removed.ok) return fail(taskId, action, removed.error);
	clearTaskWorktree(taskId);
	journalWrite({
		event: "agent_team_worktree",
		taskId,
		action,
		ok: true,
		path: worktree.path,
	});
	return {
		ok: true,
		text: `Removed worktree ${worktree.path}.`,
		task: getTask(taskId)?.task ?? view.task,
	};
}
