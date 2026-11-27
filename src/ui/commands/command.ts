/**
 * pi-subagents: the /subagents command.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { discoverSubagents } from "../../infra/files/index.ts";
import { runListMenu } from "../menu/root/index.ts";
import { openWorkspace } from "../menu/board/index.ts";
import { runSubagentDetail } from "../menu/root/index.ts";
import { showTaskList } from "../menu/board/index.ts";
import { showTrashList } from "../menu/board/index.ts";
import { ledger } from "../../app/session/index.ts";
import { helpText, shortPath } from "../view/text/index.ts";
import { subagentRow, taskRow } from "../view/text/index.ts";
import { subagentDetail } from "../view/run/index.ts";
import type { TaskStorePort } from "../../domain/task/index.ts";
import { scopeTasks } from "../../app/session/index.ts";
import { parseLaunchArgs } from "../../domain/policy/index.ts";
import { disableAgentTeam, enableAgentTeam } from "../../app/agent-team/board/index.ts";
import { startAgentTeamLaunch } from "../../app/agent-team/run/index.ts";
import { startFinish } from "../../app/launch/index.ts";
import type { AppDeps } from "../../app/index.ts";
import { finishNotice } from "../view/run/index.ts";
import { agentTeamText } from "../view/workspace/index.ts";
import { runNewSubagent } from "./new-subagent.ts";
import { routeSubagents, type SubagentsIntent } from "./route.ts";

function quickRun(
	store: TaskStorePort,
	ctx: ExtensionCommandContext,
	deps: AppDeps,
	intent: Extract<SubagentsIntent, { kind: "quick" }>,
): void {
	if (!intent.prompt) {
		ctx.ui.notify("Add a prompt: /subagents <prompt>", "warning");
		return;
	}
	const result = startFinish(store, intent.prompt, ctx, deps);
	if (!result.ok) {
		ctx.ui.notify(result.error, result.usage ? "info" : "error");
		return;
	}
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

async function teamStart(
	store: TaskStorePort,
	ctx: ExtensionCommandContext,
	deps: AppDeps,
	intent: Extract<SubagentsIntent, { kind: "team" }>,
): Promise<void> {
	if (!intent.prompt || intent.prompt.toLowerCase() === "start") {
		ctx.ui.notify("Add a prompt: /subagents team <prompt> [@a,@b]", "warning");
		return;
	}
	const parsed = parseLaunchArgs(intent.prompt);
	if (!parsed.ok) {
		ctx.ui.notify(`/subagents team: ${parsed.error}`, "warning");
		return;
	}
	const result = await startAgentTeamLaunch(
		store,
		{
			prompt: parsed.request.prompt,
			...(parsed.request.roster ? { roster: parsed.request.roster } : {}),
		},
		ctx,
		deps,
	);
	if (!result.ok) {
		ctx.ui.notify(result.error, "error");
		return;
	}
	const rows = result.tasks.map((leg) => `${leg.name} — ${leg.taskId}`).join(" · ");
	const warning =
		result.warnings && result.warnings.length > 0 ? `\nWarning: ${result.warnings.join(" ")}` : "";
	ctx.ui.notify(
		`AgentTeam started · ${result.started} started${result.queued ? ` · ${result.queued} queued` : ""}\n${rows}${warning}`,
		"info",
	);
}

export function registerSubagentsCommand(
	pi: ExtensionAPI,
	store: TaskStorePort,
	deps: AppDeps,
): void {
	pi.registerCommand("subagents", {
		description: "Run a prompt, open runs, create subagents, or manage teams",
		getArgumentCompletions: (prefix) => {
			const words = [
				"run",
				"team",
				"agent-team",
				"agent-teams",
				"help",
				"new",
				"list",
				"tasks",
				"trash",
				"finish",
			];
			try {
				const found = discoverSubagents(process.cwd());
				for (const sub of found.subagents) words.push(sub.name);
			} catch {
				/* completion must not throw */
			}
			const hits = words.filter((w) => w.startsWith(prefix));
			return hits.length > 0 ? hits.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const intent = routeSubagents(args);

			if (intent.kind === "board") {
				await openWorkspace(ctx, store, deps);
				return;
			}

			if (intent.kind === "help") {
				ctx.ui.notify(helpText(), "info");
				return;
			}

			if (intent.kind === "quick") {
				quickRun(store, ctx, deps, intent);
				return;
			}

			if (intent.kind === "team") {
				await teamStart(store, ctx, deps, intent);
				return;
			}

			if (intent.kind === "team-board") {
				if (!ctx.hasUI) {
					ctx.ui.notify(agentTeamText(), "info");
					return;
				}
				await openWorkspace(ctx, store, deps, "agent-team");
				return;
			}

			if (intent.kind === "team-on") {
				enableAgentTeam(ctx.sessionManager.getSessionId());
				ctx.ui.notify("Agent team mode on. New Task legs join the board.", "info");
				return;
			}

			if (intent.kind === "team-off") {
				disableAgentTeam();
				ctx.ui.notify("Agent team mode off. Existing tasks stay.", "info");
				return;
			}

			if (intent.kind === "tasks") {
				if (!ctx.hasUI) {
					const tasks = scopeTasks(store.list().toReversed(), {
						cwd: ctx.cwd,
						sessionId: ctx.sessionManager.getSessionId(),
					});
					const head = `Tasks · ${tasks.length} this session`;
					const body =
						tasks.length === 0 ? "(no runs yet this session)" : tasks.map(taskRow).join("\n");
					ctx.ui.notify(`${head}\n${body}`, "info");
					return;
				}
				await showTaskList(ctx, store, deps);
				return;
			}

			if (intent.kind === "trash") {
				const { userSubagentsDir } = discoverSubagents(ctx.cwd);
				if (!ctx.hasUI) {
					const { listTrash } = await import("../../infra/files/index.ts");
					const items = listTrash();
					ctx.ui.notify(
						items.length === 0
							? "Trash is empty."
							: items.map((i) => `${i.base} (${i.stamp})`).join("\n"),
						"info",
					);
					return;
				}
				await showTrashList(ctx, userSubagentsDir);
				return;
			}

			if (intent.kind === "list") {
				const { subagents, errors, userSubagentsDir, projectSubagentsDir } = discoverSubagents(
					ctx.cwd,
				);
				if (subagents.length === 0) {
					const hint = errors.length > 0 ? ` Notes: ${errors.join("; ")}` : "";
					ctx.ui.notify(`No subagents found. Add .md files to ${userSubagentsDir}.${hint}`, "info");
					return;
				}
				if (!ctx.hasUI) {
					const errHint = errors.length > 0 ? `\nNotes: ${errors.join("; ")}` : "";
					ctx.ui.notify(
						`user: ${shortPath(userSubagentsDir)} | project: ${projectSubagentsDir ? shortPath(projectSubagentsDir) : "(none)"}\n${subagents.map(subagentRow).join("\n")}${errHint}`,
						"info",
					);
					return;
				}
				await runListMenu(ctx, subagents);
				return;
			}

			if (intent.kind === "new") {
				if (!ctx.hasUI) {
					ctx.ui.notify("Create needs UI. Add a .md file by hand instead.", "warning");
					return;
				}
				const { userSubagentsDir } = discoverSubagents(ctx.cwd);
				await runNewSubagent(ctx, userSubagentsDir);
				return;
			}

			const { subagents } = discoverSubagents(ctx.cwd);
			const sub = subagents.find((s) => s.name.toLowerCase() === intent.name.toLowerCase());
			if (!sub) {
				quickRun(store, ctx, deps, { kind: "quick", prompt: intent.name });
				return;
			}
			if (!ctx.hasUI) {
				ctx.ui.notify(subagentDetail(sub, ledger.bySubagent()[sub.name]), "info");
				return;
			}
			await runSubagentDetail(ctx, sub);
		},
	});
}
