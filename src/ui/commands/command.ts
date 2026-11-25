/**
 * pi-subagents: the /subagents command.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverSubagents } from "../../infra/files/index.ts";
import { runCreateWizard } from "../menu/root/index.ts";
import { runListMenu } from "../menu/root/index.ts";
import { openWorkspace } from "../menu/board/index.ts";
import { runSubagentDetail } from "../menu/root/index.ts";
import { showTaskList } from "../menu/board/index.ts";
import { showTrashList } from "../menu/board/index.ts";
import { ledger } from "../../app/session/index.ts";
import { shortPath } from "../view/text/index.ts";
import { subagentRow, taskRow } from "../view/text/index.ts";
import { subagentDetail } from "../view/run/index.ts";
import type { TaskStorePort } from "../../domain/task/index.ts";
import { scopeTasks } from "../../app/session/index.ts";
import { parseLaunchArgs } from "../../domain/policy/index.ts";
import { disableTeam, enableTeam } from "../../app/team/board/index.ts";
import { startTeamLaunch } from "../../app/team/run/index.ts";
import { startFinish } from "../../app/launch/index.ts";
import type { AppDeps } from "../../app/index.ts";
import { finishNotice } from "../view/run/index.ts";
import { teamText } from "../view/workspace/index.ts";

export function registerSubagentsCommand(
	pi: ExtensionAPI,
	store: TaskStorePort,
	deps: AppDeps,
): void {
	pi.registerCommand("subagents", {
		description: "Mission control; list, tasks, team, finish, trash, new, or a name",
		getArgumentCompletions: (prefix) => {
			const words = ["list", "new", "tasks", "trash", "team", "finish"];
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
			const raw = args.trim();
			const query = raw.toLowerCase();

			if (query === "team") {
				if (!ctx.hasUI) {
					ctx.ui.notify(teamText(), "info");
					return;
				}
				await openWorkspace(ctx, store, deps, "team");
				return;
			}

			if (query === "team on") {
				enableTeam(ctx.sessionManager.getSessionId());
				ctx.ui.notify("Team mode on. New Task legs join the board.", "info");
				return;
			}

			if (query === "team off") {
				disableTeam();
				ctx.ui.notify("Team mode off. Existing tasks stay.", "info");
				return;
			}

			if (query === "team start") {
				ctx.ui.notify("Add a prompt: /subagents team <prompt> [@a,@b]", "warning");
				return;
			}

			if (query.startsWith("team ")) {
				const parsed = parseLaunchArgs(raw.slice("team".length).trim());
				if (!parsed.ok) {
					ctx.ui.notify(`/subagents team: ${parsed.error}`, "warning");
					return;
				}
				const result = await startTeamLaunch(
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
					result.warnings && result.warnings.length > 0
						? `\nWarning: ${result.warnings.join(" ")}`
						: "";
				ctx.ui.notify(
					`Team started · ${result.started} started${result.queued ? ` · ${result.queued} queued` : ""}\n${rows}${warning}`,
					"info",
				);
				return;
			}

			if (query === "finish" || query.startsWith("finish ")) {
				const result = startFinish(store, raw.slice("finish".length).trim(), ctx, deps);
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
				return;
			}

			if (query === "tasks") {
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

			if (query === "trash") {
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

			if (query === "list") {
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

			if (query === "new") {
				if (!ctx.hasUI) {
					ctx.ui.notify("Create needs UI. Add a .md file by hand instead.", "warning");
					return;
				}
				const { userSubagentsDir } = discoverSubagents(ctx.cwd);
				await runCreateWizard(ctx, userSubagentsDir);
				return;
			}

			if (query) {
				const { subagents } = discoverSubagents(ctx.cwd);
				const sub = subagents.find((s) => s.name.toLowerCase() === query);
				if (!sub) {
					ctx.ui.notify(`Unknown subagent "${raw}".`, "error");
					return;
				}
				if (!ctx.hasUI) {
					ctx.ui.notify(subagentDetail(sub, ledger.bySubagent()[sub.name]), "info");
					return;
				}
				await runSubagentDetail(ctx, sub);
				return;
			}

			await openWorkspace(ctx, store, deps);
		},
	});
}
