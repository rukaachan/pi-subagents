/**
 * pi-subagents: the /subagents mission control workspace.
 */

import { copyToClipboard, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AppDeps } from "../../../app/index.ts";
import { inModal } from "../../../app/stop/index.ts";
import { liveSession } from "../../../app/live/index.ts";
import {
	disableAgentTeam,
	enableAgentTeam,
	agentTeamEnabled,
	agentTeamSummary,
} from "../../../app/agent-team/board/index.ts";
import { retryTask, steerTask, stopTaskById } from "../../../app/run/index.ts";
import { linkedRun } from "../../../app/agent-team/run/index.ts";
import { startFinish } from "../../../app/launch/index.ts";
import { scopeTasks, type TaskScope } from "../../../app/session/index.ts";
import type { TaskStorePort } from "../../../domain/task/index.ts";
import { buildBoard, type BoardRow } from "../../view/board/index.ts";
import { taskRow } from "../../view/text/index.ts";
import { agentTeamRows, roundRows } from "./agent-team-rows.ts";
import { agentTeamText } from "../../view/workspace/index.ts";
import {
	workspaceHeight,
	type WorkspaceAction,
	type WorkspaceData,
	type WorkspaceTab,
} from "../../view/workspace/index.ts";
import { createWorkspaceView } from "../../view/workspace/index.ts";
import { finishNotice } from "../../view/run/index.ts";
import { openSessionView } from "../../view/session/index.ts";
import { runAgentTeamAction } from "./agent-team-actions.ts";

function scopeOf(ctx: ExtensionCommandContext): TaskScope {
	return { cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId() };
}

function runsOf(store: TaskStorePort, scope: TaskScope): BoardRow[] {
	return buildBoard(scopeTasks(store.list(), scope), { live: (id) => !!liveSession(id) });
}

function dataOf(
	store: TaskStorePort,
	scope: TaskScope,
	runs: BoardRow[] = runsOf(store, scope),
): WorkspaceData {
	return {
		runs,
		agentTeam: agentTeamRows(),
		agentTeamRounds: roundRows(store),
		agentTeamEnabled: agentTeamEnabled(),
		summary: agentTeamSummary(),
	};
}

function mountWorkspace(
	ctx: ExtensionCommandContext,
	store: TaskStorePort,
	scope: TaskScope,
	tab: WorkspaceTab,
): Promise<WorkspaceAction | undefined> {
	return ctx.ui.custom<WorkspaceAction | undefined>(
		(tui, theme, _kb, done) => {
			let finished = false;
			let showHidden = false;
			const runs = () => {
				const rows = runsOf(store, scope);
				return showHidden
					? rows
					: rows.filter((row) => row.section !== "failed" && row.section !== "stopped");
			};
			const hidden = () => {
				const rows = runsOf(store, scope);
				return {
					failed: rows.filter((row) => row.section === "failed").length,
					stopped: rows.filter((row) => row.section === "stopped").length,
					hidden: !showHidden,
				};
			};
			const finish = (action: WorkspaceAction | undefined) => {
				if (finished) return;
				finished = true;
				done(action);
			};
			const view = createWorkspaceView({
				tab,
				runs,
				hidden,
				toggleHidden: () => {
					showHidden = !showHidden;
					tui.requestRender();
				},
				agentTeam: agentTeamRows,
				agentTeamEnabled,
				summary: agentTeamSummary,
				height: (which) => {
					const data = dataOf(store, scope, runs());
					return Math.max(
						6,
						Math.min(Math.floor(tui.terminal.rows * 0.85), workspaceHeight(which, data)),
					);
				},
				theme,
				render: () => tui.requestRender(),
				onAction: finish,
				poll: true,
				subscribe: (fn) => store.subscribe(fn),
			});
			return {
				render: view.render,
				handleInput: view.handleInput,
				invalidate: () => {},
				dispose: () => view.dispose(),
			};
		},
		{
			overlay: true,
			overlayOptions: { anchor: "center", width: "90%", maxHeight: "90%" },
		},
	);
}

async function runRunsAction(
	ctx: ExtensionCommandContext,
	store: TaskStorePort,
	action: WorkspaceAction,
	deps: AppDeps,
): Promise<void> {
	if (action.kind === "open") {
		const rec = store.get(action.taskId);
		if (rec) await openSessionView(ctx, rec);
		return;
	}
	if (action.kind === "copy") {
		try {
			await copyToClipboard(action.taskId);
			ctx.ui.notify(`Copied ${action.taskId}.`, "info");
		} catch {
			ctx.ui.notify(action.taskId, "info");
		}
		return;
	}
	if (action.kind === "steer") {
		const text = await inModal(() => ctx.ui.input(`Steer ${action.taskId}`, ""));
		if (!text) return;
		const result = await steerTask(store, action.taskId, text);
		ctx.ui.notify(result.message, result.ok ? "info" : "error");
		return;
	}
	if (action.kind === "stop") {
		const result = stopTaskById(store, action.taskId);
		ctx.ui.notify(result.message, result.ok ? "info" : "error");
		return;
	}
	if (action.kind !== "retry") return;
	const result = retryTask(store, action.taskId, ctx, deps);
	ctx.ui.notify(result.message, result.ok ? "info" : "error");
}

function plainWorkspace(store: TaskStorePort, scope: TaskScope): string {
	const runs = scopeTasks(store.list(), scope).toReversed();
	const runText = runs.length === 0 ? "Runs: none this session." : runs.map(taskRow).join("\n");
	return `${runText}\n\n${agentTeamText()}`;
}

export async function openWorkspace(
	ctx: ExtensionCommandContext,
	store: TaskStorePort,
	deps: AppDeps,
	initialTab: WorkspaceTab = "runs",
): Promise<void> {
	const scope = scopeOf(ctx);
	if (typeof ctx.ui.custom !== "function" || ctx.mode !== "tui") {
		ctx.ui.notify(plainWorkspace(store, scope), "info");
		return;
	}
	let tab = initialTab;
	for (;;) {
		const action = await inModal(() => mountWorkspace(ctx, store, scope, tab));
		if (!action || action.kind === "close") return;
		if (action.kind === "agent-team-toggle") {
			if (agentTeamEnabled()) {
				disableAgentTeam();
				ctx.ui.notify("Agent team mode off. Existing tasks stay.", "info");
			} else {
				enableAgentTeam(ctx.sessionManager.getSessionId());
				ctx.ui.notify("Agent team mode on. New Task legs join the board.", "info");
			}
			tab = "agent-team";
			continue;
		}
		if (action.kind === "agent-team-open-run") {
			const linked = linkedRun(store, action.taskId);
			if (!linked.ok) {
				ctx.ui.notify(linked.error, "info");
				tab = "agent-team";
				continue;
			}
			await openSessionView(ctx, linked.rec);
			tab = "agent-team";
			continue;
		}
		if (action.kind.startsWith("agent-team-")) {
			await runAgentTeamAction(action, ctx, store, deps);
			tab = "agent-team";
			continue;
		}
		if (action.kind === "finish") {
			const prompt = await inModal(() => ctx.ui.input("What should the subagent do?", ""));
			if (prompt) {
				const result = startFinish(store, prompt, ctx, deps);
				if (!result.ok) {
					ctx.ui.notify(result.error, result.usage ? "info" : "error");
				} else {
					ctx.ui.notify(
						finishNotice(
							result.start.run.legs,
							result.start.started,
							result.start.queued,
							result.start.picks,
							result.start.dropped,
						),
						"info",
					);
				}
			}
			tab = "runs";
			continue;
		}
		await runRunsAction(ctx, store, action, deps);
		tab = "runs";
	}
}
