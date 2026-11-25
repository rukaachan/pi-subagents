/**
 * pi-subagents: the /subagents root menu.
 */

import { pickFromList } from "../../index.ts";
import { subagentRowItems } from "./items.ts";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SubagentConfig } from "../../../domain/subagent/index.ts";
import { runSubagentDetail } from "./detail.ts";

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
