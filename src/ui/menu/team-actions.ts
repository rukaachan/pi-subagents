/**
 * pi-subagents: Team tab actions.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { TeamTaskView, TeamUpdate } from "../../domain/team.ts";
import { inModal } from "../../app/modal-depth.ts";
import { startTeamLaunch } from "../../app/team-launch.ts";
import { createTask, getTask, teamMembers, updateTask } from "../../app/team-store.ts";
import type { TaskStore } from "../../app/task-store.ts";
import { pickFromList } from "../picker.ts";
import { shortText } from "../view/format.ts";
import type { WorkspaceAction } from "../view/workspace-screen.ts";

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

function taskOf(ctx: ExtensionCommandContext, taskId: string): TeamTaskView | undefined {
	const view = getTask(taskId);
	if (!view) notice(ctx, `Unknown task "${taskId}".`, "error");
	return view;
}

function update(
	ctx: ExtensionCommandContext,
	view: TeamTaskView,
	action: TeamUpdate["action"],
	extra: Partial<TeamUpdate> = {},
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
	const members = teamMembers().map((member) => member.name);
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

async function confirmDelete(ctx: ExtensionCommandContext, view: TeamTaskView): Promise<void> {
	const ok = await inModal(() =>
		ctx.ui.confirm("Delete task?", `${view.task.id} · ${shortText(view.task.subject, 60)}`),
	);
	if (ok) update(ctx, view, "delete");
}

async function startFlow(ctx: ExtensionCommandContext, store: TaskStore): Promise<void> {
	const prompt = await input(ctx, "Team prompt");
	if (!prompt) return;
	const raw = await input(ctx, "Roster (comma-separated, blank = all)");
	if (raw === undefined) return;
	const roster = raw
		.split(/[\s,]+/)
		.map((name) => name.replace(/^@/, "").trim())
		.filter(Boolean);
	const result = await startTeamLaunch(
		store,
		{ prompt, ...(roster.length ? { roster } : {}) },
		ctx,
	);
	if (!result.ok) {
		notice(ctx, result.error, "error");
		return;
	}
	const rows = result.tasks.map((leg) => `${leg.name} — ${leg.taskId}`).join(" · ");
	notice(
		ctx,
		`Team started · ${result.started} started${result.queued ? ` · ${result.queued} queued` : ""}\n${rows}`,
	);
}

function detailText(view: TeamTaskView): string {
	const task = view.task;
	return [
		`${task.id} [${task.status}] rev ${task.revision} · ${task.subject}`,
		`owner: ${task.owner ?? "unowned"} · scopes: ${task.writeScopes.join(",") || "none"}`,
		view.blockedByOpen.length ? `blocked by: ${view.blockedByOpen.join(",")}` : "",
		task.lastError ? `last ${task.lastOwner ?? "run"}: ${task.lastError}` : "",
		task.description || "(no description)",
	]
		.filter(Boolean)
		.join("\n");
}

async function detailFlow(ctx: ExtensionCommandContext, taskId: string): Promise<void> {
	const view = taskOf(ctx, taskId);
	if (view) notice(ctx, detailText(view));
}

export async function runTeamAction(
	action: WorkspaceAction,
	ctx: ExtensionCommandContext,
	store: TaskStore,
): Promise<void> {
	if (action.kind === "team-new") return createFlow(ctx);
	if (action.kind === "team-edit") return editFlow(ctx, action.taskId);
	if (action.kind === "team-assign") return assignFlow(ctx, action.taskId);
	if (
		action.kind === "team-claim" ||
		action.kind === "team-release" ||
		action.kind === "team-complete"
	) {
		const view = taskOf(ctx, action.taskId);
		if (!view) return;
		const verb = action.kind.replace("team-", "") as TeamUpdate["action"];
		return update(ctx, view, verb);
	}
	if (action.kind === "team-delete") {
		const view = taskOf(ctx, action.taskId);
		if (view) await confirmDelete(ctx, view);
		return;
	}
	if (action.kind === "team-detail") return detailFlow(ctx, action.taskId);
	if (action.kind === "team-start") return startFlow(ctx, store);
}
