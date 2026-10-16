/**
 * pi-subagents: one subagent, editable.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SubagentConfig } from "../../domain/subagent/config.ts";
import type { EditableField } from "../../infra/files.ts";
import { ledger } from "../../app/ledger.ts";
import { discoverSubagents } from "../../infra/subagent-files.ts";
import {
	BUDGET_EDIT_FIELDS,
	EDITABLE_FIELDS,
	FIELD_CHOICES,
	currentBudgetValue,
	editBudgetField,
	editSubagentField,
	trashDir,
} from "../../infra/files.ts";
import type { BudgetEditField } from "../../infra/files.ts";
import { trashSubagentFile } from "../../infra/trash.ts";
import { currentFieldValue, pickModel, pickTools } from "./wizard-fields.ts";
import { pickChoice, pickFromList } from "../picker.ts";
import { subagentDetail } from "../view/detail.ts";
import { shortPath } from "../view/format.ts";
import { inModal } from "../../app/modal-depth.ts";

export async function runEditFlow(
	ctx: ExtensionCommandContext,
	sub: SubagentConfig,
): Promise<SubagentConfig> {
	for (;;) {
		const field = await pickFromList(ctx, {
			title: `Edit ${sub.name}`,
			subtitle: shortPath(sub.filePath),
			items: [
				...EDITABLE_FIELDS.map((f) => ({ value: f, label: f })),
				{
					value: "budget…",
					label: "budget…",
					description: "timeout, turns, tokens, report cap",
				},
				{ value: "✓ Done editing", label: "✓ Done editing" },
			],
		});
		if (!field || field === "✓ Done editing") return sub;
		if (field === "budget…") {
			sub = await editBudget(ctx, sub);
			continue;
		}
		const f = field as EditableField;
		let value: string | undefined;
		if (f === "model") {
			value = await pickModel(ctx, sub.model);
			if (value === undefined) continue;
		} else if (f === "tools") {
			value = await pickTools(ctx, sub.tools);
			if (value === undefined) continue;
		} else {
			const choices = FIELD_CHOICES[f];
			if (choices.length > 0) {
				const pick = await pickChoice(ctx, f, choices, currentFieldValue(sub, f));
				if (!pick) continue;
				value = pick;
			} else {
				const current = currentFieldValue(sub, f);
				value = await inModal(() => ctx.ui.input(f, current));
				if (value === undefined) continue;
			}
		}
		const err = editSubagentField(sub.filePath, f, value);
		if (err) {
			ctx.ui.notify(err, "error");
			continue;
		}
		ctx.ui.notify(`Updated ${sub.name}: ${f}.`, "info");
		const fresh = discoverSubagents(ctx.cwd).subagents.find((s) => s.name === sub.name);
		if (fresh) sub = fresh;
	}
}

async function editBudget(
	ctx: ExtensionCommandContext,
	sub: SubagentConfig,
): Promise<SubagentConfig> {
	for (;;) {
		const field = await pickFromList(ctx, {
			title: `Budget ${sub.name}`,
			subtitle: "blank clears a cap; a cleared budget uses the built-in default",
			items: [
				...BUDGET_EDIT_FIELDS.map((f) => ({
					value: f,
					label: f,
					description: currentBudgetValue(sub, f) || "(unset)",
				})),
				{ value: "← Back", label: "← Back" },
			],
		});
		if (!field || field === "← Back") return sub;
		const f = field as BudgetEditField;
		const value = await inModal(() =>
			ctx.ui.input(`${f} (blank clears)`, currentBudgetValue(sub, f)),
		);
		if (value === undefined) continue;
		const err = editBudgetField(sub.filePath, f, value);
		if (err) {
			ctx.ui.notify(err, "error");
			continue;
		}
		ctx.ui.notify(`Updated ${sub.name}: budget.${f}.`, "info");
		const fresh = discoverSubagents(ctx.cwd).subagents.find((s) => s.name === sub.name);
		if (fresh) sub = fresh;
	}
}

export async function runSubagentDetail(
	ctx: ExtensionCommandContext,
	sub: SubagentConfig,
): Promise<"deleted" | "back"> {
	ctx.ui.notify(subagentDetail(sub, ledger.bySubagent()[sub.name]), "info");
	for (;;) {
		const action = await pickFromList(ctx, {
			title: sub.name,
			subtitle: subagentDetail(sub, ledger.bySubagent()[sub.name]).split("\n")[1] ?? "",
			items: [
				{ value: "Edit", label: "Edit", description: "change fields in place" },
				{
					value: "Delete (to trash)",
					label: "Delete (to trash)",
					description: "recoverable from Trash",
				},
				{ value: "← Back to subagents", label: "← Back to subagents" },
			],
		});
		if (!action || action === "← Back to subagents") return "back";
		if (action === "Edit") {
			sub = await runEditFlow(ctx, sub);
			ctx.ui.notify(subagentDetail(sub, ledger.bySubagent()[sub.name]), "info");
			continue;
		}
		const ok = await inModal(() =>
			ctx.ui.confirm(
				"Move to trash?",
				`${sub.name} at ${shortPath(sub.filePath)}.\nTrash: ${shortPath(trashDir())}`,
			),
		);
		if (!ok) continue;
		const trashed = trashSubagentFile(sub.filePath);
		if ("error" in trashed) {
			ctx.ui.notify(trashed.error, "error");
			continue;
		}
		ctx.ui.notify(`Moved ${sub.name} to trash. Open Trash to bring it back.`, "info");
		return "deleted";
	}
}
