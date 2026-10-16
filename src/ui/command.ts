/**
 * pi-subagents: the /subagents command.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverSubagents } from "../infra/subagent-files.ts";
import { runCreateWizard } from "./menu/wizard.ts";
import { runListMenu, runMenu } from "./menu/root.ts";
import { runSubagentDetail } from "./menu/detail.ts";
import { showTaskList } from "./menu/task-list.ts";
import { showTrashList } from "./menu/trash.ts";
import { ledger } from "../app/ledger.ts";
import { shortPath } from "./view/format.ts";
import { spawnSummary, subagentRow, taskRow } from "./view/rows.ts";
import { subagentDetail } from "./view/detail.ts";
import { TaskStore } from "../app/task-store.ts";

export function registerSubagentsCommand(pi: ExtensionAPI, store: TaskStore): void {
	pi.registerCommand("subagents", {
		description: "Live runs; list, tasks, trash, new, or a name",
		getArgumentCompletions: (prefix) => {
			const words = ["list", "new", "tasks", "trash"];
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

			if (query === "tasks") {
				if (!ctx.hasUI) {
					const tasks = store.list().toReversed();
					const head = spawnSummary(ledger.bySubagent());
					const body =
						tasks.length === 0 ? "(no runs yet this session)" : tasks.map(taskRow).join("\n");
					ctx.ui.notify(`${head}\n${body}`, "info");
					return;
				}
				await showTaskList(ctx, store);
				return;
			}

			if (query === "trash") {
				const { userSubagentsDir } = discoverSubagents(ctx.cwd);
				if (!ctx.hasUI) {
					const { listTrash } = await import("../infra/trash.ts");
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

			if (!ctx.hasUI) {
				const live = store.list().filter((t) => t.status === "running");
				ctx.ui.notify(
					live.length === 0
						? "No live runs. Use /subagents list for files, /subagents tasks for past runs."
						: live.map(taskRow).join("\n"),
					"info",
				);
				return;
			}

			await runMenu(ctx, store);
		},
	});
}
