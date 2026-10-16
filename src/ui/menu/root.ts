/**
 * pi-subagents: the /subagents root menu.
 */

import { pickFromList } from "../picker.ts";
import { subagentRowItems, taskRowItems } from "./items.ts";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { TaskStore } from "../../app/task-store.ts";
import type { SubagentConfig } from "../../domain/subagent/config.ts";
import { runSubagentDetail } from "./detail.ts";
import { showTaskDetail, sortTaskRows } from "./task-list.ts";

export async function runListMenu(
	ctx: ExtensionCommandContext,
	subagents: SubagentConfig[],
): Promise<void> {
	for (;;) {
		const pick = await pickFromList(ctx, {
			title: `Subagents (${subagents.length})`,
			subtitle: "◇ personal ◈ project · enter opens one",
			items: subagentRowItems(subagents),
		});
		if (!pick) return;
		const sub = subagents.find((s) => s.name === pick);
		if (!sub) continue;
		await runSubagentDetail(ctx, sub);
	}
}

export async function runMenu(ctx: ExtensionCommandContext, store: TaskStore): Promise<void> {
	for (;;) {
		const live = sortTaskRows(store.list()).filter((t) => t.status === "running");
		if (live.length === 0) {
			ctx.ui.notify(
				"No live runs. /subagents list shows the subagent files, /subagents tasks shows past runs.",
				"info",
			);
			return;
		}
		const pick = await pickFromList(ctx, {
			title: `Live runs (${live.length})`,
			subtitle: "running now · enter opens the run",
			items: taskRowItems(live),
		});
		if (!pick) return;
		const rec = live.find((t) => t.taskId === pick);
		if (!rec) {
			ctx.ui.notify("That run finished.", "info");
			continue;
		}
		await showTaskDetail(ctx, store, rec);
	}
}
