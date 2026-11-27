/**
 * pi-subagents: Agent team tab actions.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AppDeps } from "../../../app/index.ts";
import type { AgentTeamTaskView, AgentTeamUpdate } from "../../../domain/agent-team/index.ts";
import { inModal } from "../../../app/stop/index.ts";
import { startAgentTeamLaunch } from "../../../app/agent-team/run/index.ts";
import { adviseAgentTeam } from "../../../app/agent-team/advisor/index.ts";
import { startAgentTeamVerification } from "../../../app/agent-team/verify-run/index.ts";
import {
	createTask,
	getTask,
	agentTeamMembers,
	updateTask,
} from "../../../app/agent-team/board/index.ts";
import type { TaskStorePort } from "../../../domain/task/index.ts";
import { pickFromList } from "../../index.ts";
import { shortText } from "../../view/text/index.ts";
import type { WorkspaceAction } from "../../view/workspace/index.ts";

function notice(ctx: ExtensionCommandContext, text: string, kind: "info" | "error" = "info"): void {
	ctx.ui.notify(text, kind);
}

async function input(
	ctx: ExtensionCommandContext,
	title: string,
	value = "",
): Promise<string | undefined> {
	return inModal(() => ctx.ui.input(title, value));
}

function scopesOf(value: string): string[] {
	return value
		.split(",")
		.map((scope) => scope.trim())
		.filter(Boolean);
}

function taskOf(ctx: ExtensionCommandContext, taskId: string): AgentTeamTaskView | undefined {
	const view = getTask(taskId);
	if (!view) notice(ctx, `Unknown task "${taskId}".`, "error");
	return view;
}

function update(
	ctx: ExtensionCommandContext,
	view: AgentTeamTaskView,
	action: AgentTeamUpdate["action"],
	extra: Partial<AgentTeamUpdate> = {},
): void {
	const result = updateTask(
		{ taskId: view.task.id, expectedRevision: view.task.revision, action, ...extra },
		{ name: "lead", lead: true },
	);
	notice(
		ctx,
		result.ok ? `${action} · ${result.task.id}` : result.error,
		result.ok ? "info" : "error",
	);
}

async function createFlow(ctx: ExtensionCommandContext): Promise<void> {
	const subject = await input(ctx, "Task subject");
	if (!subject) return;
	const description = (await input(ctx, "Description (optional)")) ?? "";
	const scopes = await input(ctx, "Write scopes, comma-separated (optional)");
	if (scopes === undefined) return;
	const result = createTask({ subject, description, writeScopes: scopesOf(scopes) });
	notice(
		ctx,
		result.ok ? `Created ${result.task.id}.` : result.error,
		result.ok ? "info" : "error",
	);
}

async function editFlow(ctx: ExtensionCommandContext, taskId: string): Promise<void> {
	const view = taskOf(ctx, taskId);
	if (!view) return;
	const subject = await input(ctx, "Task subject", view.task.subject);
	if (subject === undefined) return;
	const description = await input(ctx, "Description", view.task.description);
	if (description === undefined) return;
	const scopes = await input(ctx, "Write scopes, comma-separated", view.task.writeScopes.join(","));
	if (scopes === undefined) return;
	update(ctx, view, "edit", {
		subject,
		description,
		writeScopes: scopesOf(scopes),
	});
}

async function assignFlow(ctx: ExtensionCommandContext, taskId: string): Promise<void> {
	const view = taskOf(ctx, taskId);
	if (!view) return;
	const members = agentTeamMembers().map((member) => member.name);
	const owner = await pickFromList(ctx, {
		title: `Assign ${taskId}`,
		subtitle: "lead can assign any known member",
		items: [
			...members.map((name) => ({ value: name, label: name })),
			{ value: "", label: "(unassign)" },
		],
	});
	if (owner === undefined) return;
	update(ctx, view, "reassign", { owner });
}

async function verifyFlow(ctx: ExtensionCommandContext, taskId: string): Promise<void> {
	const view = taskOf(ctx, taskId);
	if (!view) return;
	if (view.task.status !== "in_review") {
		notice(ctx, "Only a task in review can be verified.", "error");
		return;
	}
	const verdict = await pickFromList(ctx, {
		title: `Verify ${taskId}`,
		subtitle: "lead override is journaled",
		items: [
			{ value: "pass", label: "pass" },
			{ value: "fail", label: "fail" },
		],
	});
	if (verdict !== "pass" && verdict !== "fail") return;
	const pass = verdict === "pass";
	const note = await input(ctx, pass ? "Why pass? (journaled)" : "Why did it fail?");
	if (note === undefined) return;
	if (!note.trim()) {
		notice(
			ctx,
			pass ? "A lead override needs a note." : "A failed verification needs a note.",
			"error",
		);
		return;
	}
	const extra = await input(
		ctx,
		pass ? "Fact to keep (optional)" : "Dead end to record (optional)",
	);
	if (extra === undefined) return;
	update(ctx, view, "verify", {
		verdict,
		override: true,
		note,
		...(extra.trim() ? (pass ? { fact: extra.trim() } : { excluded: extra.trim() }) : {}),
	});
}

async function adviseFlow(
	ctx: ExtensionCommandContext,
	taskId: string,
	store: TaskStorePort,
	deps: AppDeps,
): Promise<void> {
	const question = await input(ctx, "Ask the advisor");
	if (!question) return;
	const result = await adviseAgentTeam(store, question, taskId, ctx, deps);
	notice(ctx, result.ok ? result.text : result.error, result.ok ? "info" : "error");
}

async function confirmDelete(ctx: ExtensionCommandContext, view: AgentTeamTaskView): Promise<void> {
	const ok = await inModal(() =>
		ctx.ui.confirm("Delete task?", `${view.task.id} · ${shortText(view.task.subject, 60)}`),
	);
	if (ok) update(ctx, view, "delete");
}

async function startFlow(
	ctx: ExtensionCommandContext,
	store: TaskStorePort,
	deps: AppDeps,
): Promise<void> {
	const prompt = await input(ctx, "Agent team prompt");
	if (!prompt) return;
	const raw = await input(ctx, "Roster (comma-separated, blank = all)");
	if (raw === undefined) return;
	const roster = raw
		.split(/[\s,]+/)
		.map((name) => name.replace(/^@/, "").trim())
		.filter(Boolean);
	const result = await startAgentTeamLaunch(
		store,
		{ prompt, ...(roster.length ? { roster } : {}) },
		ctx,
		deps,
	);
	if (!result.ok) {
		notice(ctx, result.error, "error");
		return;
	}
	const rows = result.tasks.map((leg) => `${leg.name} — ${leg.taskId}`).join(" · ");
	const warning =
		result.warnings && result.warnings.length > 0 ? `\nWarning: ${result.warnings.join(" ")}` : "";
	notice(
		ctx,
		`AgentTeam started · ${result.started} started${result.queued ? ` · ${result.queued} queued` : ""}\n${rows}${warning}`,
	);
}

export async function runAgentTeamAction(
	action: WorkspaceAction,
	ctx: ExtensionCommandContext,
	store: TaskStorePort,
	deps: AppDeps,
): Promise<void> {
	if (action.kind === "agent-team-new") return createFlow(ctx);
	if (action.kind === "agent-team-edit") return editFlow(ctx, action.taskId);
	if (action.kind === "agent-team-assign") return assignFlow(ctx, action.taskId);
	if (
		action.kind === "agent-team-claim" ||
		action.kind === "agent-team-release" ||
		action.kind === "agent-team-complete"
	) {
		const view = taskOf(ctx, action.taskId);
		if (!view) return;
		const verb = action.kind.replace("agent-team-", "") as AgentTeamUpdate["action"];
		update(ctx, view, verb);
		if (verb === "complete" && getTask(action.taskId)?.task.status === "in_review") {
			startAgentTeamVerification(store, action.taskId, ctx, deps);
		}
		return;
	}
	if (action.kind === "agent-team-delete") {
		const view = taskOf(ctx, action.taskId);
		if (view) await confirmDelete(ctx, view);
		return;
	}
	if (action.kind === "agent-team-verify") return verifyFlow(ctx, action.taskId);
	if (action.kind === "agent-team-advise") return adviseFlow(ctx, action.taskId, store, deps);
	if (action.kind === "agent-team-start") return startFlow(ctx, store, deps);
}
