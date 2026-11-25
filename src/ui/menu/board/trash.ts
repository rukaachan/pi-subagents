/**
 * pi-subagents: the trash browser.
 */

import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_DIR_NAME } from "../../../domain/subagent/index.ts";
import { discoverSubagents } from "../../../infra/files/index.ts";
import { listTrash, restoreTrashFile } from "../../../infra/files/index.ts";
import { ROUTE } from "../root/index.ts";
import { trashRowItems } from "../root/index.ts";
import { pickAction, pickFromList } from "../../index.ts";
import { shortPath } from "../../view/text/index.ts";

export async function showTrashList(
	ctx: ExtensionCommandContext,
	userSubagentsDir: string,
): Promise<void> {
	for (;;) {
		const items = listTrash();
		if (items.length === 0) {
			ctx.ui.notify("Trash is empty.", "info");
			return;
		}
		const pick = await pickFromList(ctx, {
			title: `Trash (${items.length})`,
			subtitle: "deleted subagent files · restore to personal or project",
			items: [...trashRowItems(items), { value: ROUTE.cancel, label: "← Back to subagents" }],
		});
		if (!pick || pick === ROUTE.cancel) return;
		const item = items.find((i) => i.base === pick);
		if (!item) continue;
		const action = await pickAction(ctx, item.fileName, [
			"Restore to personal",
			"Restore to project",
			"← Back to subagents",
		]);
		if (!action || action === "← Back to subagents") continue;
		let dir = userSubagentsDir;
		if (action === "Restore to project") {
			if (!ctx.isProjectTrusted()) {
				ctx.ui.notify("Project not trusted. Trust it first, then retry.", "error");
				continue;
			}
			const found = discoverSubagents(ctx.cwd);
			dir = found.projectSubagentsDir ?? path.join(ctx.cwd, CONFIG_DIR_NAME, SUBAGENT_DIR_NAME);
		}
		const back = restoreTrashFile(item.trashPath, dir);
		if ("error" in back) {
			ctx.ui.notify(back.error, "error");
			continue;
		}
		ctx.ui.notify(`Restored ${shortPath(back.path)}.`, "info");
		return;
	}
}
