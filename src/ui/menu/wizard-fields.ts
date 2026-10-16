/**
 * pi-subagents: field pickers shared by the wizard and the editor.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SubagentConfig } from "../../domain/subagent/config.ts";
import type { EditableField } from "../../infra/files.ts";
import { FIELD_CHOICES } from "../../infra/files.ts";
import { pickChoice, pickFromList } from "../picker.ts";
import { inModal } from "../../app/modal-depth.ts";
import { modelRow } from "../view/format.ts";

export function currentFieldValue(sub: SubagentConfig, field: EditableField): string {
	switch (field) {
		case "description":
			return sub.description;
		case "model":
			return sub.model;
		case "thinkingLevel":
			return sub.thinkingLevel ?? "";
		case "tools":
			return sub.tools?.join(", ") ?? "";
		case "autonomy":
			return sub.autonomy;
		case "codemode":
			return sub.codemode === undefined
				? "(default: only)"
				: sub.codemode === false
					? "off"
					: sub.codemode === true
						? "on"
						: "only";
	}
}

export async function pickModel(
	ctx: ExtensionCommandContext,
	current: string,
	title = "Model",
): Promise<string | undefined> {
	const models = ctx.modelRegistry.getAvailable();
	const items = [
		{
			value: "inherit",
			label: "inherit",
			description: "use the parent session model (default)",
		},
		...models.map((m) => {
			const value = modelRow(String(m.provider), m.id);
			return {
				value,
				label: value,
				description: value === current ? "(current)" : undefined,
			};
		}),
		{ value: "custom…", label: "custom…", description: "type a provider/id" },
	];
	const pick = await pickFromList(ctx, {
		title,
		subtitle: `now: ${current || "inherit"} · ${models.length} available`,
		items,
		maxVisible: 14,
	});
	if (pick === undefined) return undefined;
	if (pick === "custom…") {
		const custom = await inModal(() =>
			ctx.ui.input("Custom model (provider/id)", current === "inherit" ? "" : current),
		);
		return custom;
	}
	return pick;
}

export async function pickTools(
	ctx: ExtensionCommandContext,
	current?: string[],
	title = "Tools",
): Promise<string | undefined> {
	const pick = await pickChoice(ctx, title, FIELD_CHOICES.tools, current?.join(", "));
	if (!pick) return undefined;
	if (pick === "custom…") {
		const custom = await inModal(() =>
			ctx.ui.input("Custom tools (a, b)", current ? current.join(", ") : ""),
		);
		return custom;
	}
	return pick;
}
