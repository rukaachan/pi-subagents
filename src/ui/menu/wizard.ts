/**
 * pi-subagents: the create wizard.
 */

import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_DIR_NAME } from "../../domain/subagent/config.ts";
import { discoverSubagents } from "../../infra/subagent-files.ts";
import {
	FIELD_CHOICES,
	templateFromStarter,
	validateName,
	writeSubagentFile,
} from "../../infra/files.ts";
import { pickChoice, pickFromList } from "../picker.ts";
import { pickModel, pickTools } from "./wizard-fields.ts";
import { inModal } from "../../app/modal-depth.ts";
import { shortPath, shortText, stepTitle } from "../view/format.ts";

export async function runCreateWizard(
	ctx: ExtensionCommandContext,
	userSubagentsDir: string,
): Promise<string | null> {
	const TOTAL = 10;
	const loc = await pickFromList(ctx, {
		title: stepTitle(1, TOTAL, "Location"),
		subtitle: "where the subagent file lives",
		items: [
			{
				value: "personal",
				label: "personal",
				description: "~/.pi/agent/subagents — shared by all projects",
			},
			{
				value: "project",
				label: "project",
				description: ".pi/subagents — this repo only, needs trust",
			},
		],
	});
	if (!loc) return null;
	const isProject = loc === "project";
	let dir = userSubagentsDir;
	if (isProject) {
		if (!ctx.isProjectTrusted()) {
			ctx.ui.notify("Project not trusted. Trust it first, then retry.", "error");
			return null;
		}
		const found = discoverSubagents(ctx.cwd);
		dir = found.projectSubagentsDir ?? path.join(ctx.cwd, CONFIG_DIR_NAME, SUBAGENT_DIR_NAME);
	}

	let name = "";
	for (;;) {
		const typed = await inModal(() =>
			ctx.ui.input(stepTitle(2, TOTAL, "Name (a-z, 0-9, -, _)"), "my-worker"),
		);
		if (!typed) return null;
		name = typed.trim();
		const bad = validateName(name);
		if (bad) {
			ctx.ui.notify(`${bad} Try again.`, "warning");
			continue;
		}
		break;
	}

	const subs = discoverSubagents(ctx.cwd).subagents;
	const starterPick = await pickFromList(ctx, {
		title: stepTitle(3, TOTAL, "Start from"),
		subtitle: "copy a subagent's prompt and settings, or start empty",
		items: [
			...subs.map((sub) => ({
				value: sub.name,
				label: sub.name,
				description: shortText(sub.description || "(no description)", 58),
			})),
			{ value: "blank", label: "blank", description: "write the prompt yourself" },
		],
	});
	if (!starterPick) return null;
	const base = starterPick === "blank" ? null : (subs.find((s) => s.name === starterPick) ?? null);

	const desc = await inModal(() =>
		ctx.ui.input(
			stepTitle(4, TOTAL, "Description"),
			base?.description || "What it does. Use when X.",
		),
	);
	if (desc === undefined) return null;

	const model = await pickModel(ctx, base?.model || "inherit", stepTitle(5, TOTAL, "Model"));
	if (model === undefined) return null;

	const toolsPick = await pickTools(ctx, base?.tools, stepTitle(6, TOTAL, "Tools"));
	if (toolsPick === undefined) return null;
	let toolsLine = "read-only";
	if (toolsPick === "all tools") toolsLine = "";
	else if (toolsPick === "custom…") toolsLine = "";
	else toolsLine = toolsPick;
	if (
		toolsPick !== "all tools" &&
		toolsPick !== "read-only" &&
		toolsPick !== "edit" &&
		toolsPick !== "execute"
	) {
		toolsLine = toolsPick;
	}

	const levelPick = await pickChoice(
		ctx,
		stepTitle(7, TOTAL, "Thinking level"),
		FIELD_CHOICES.thinkingLevel,
	);
	if (!levelPick) return null;

	const autoPick = await pickChoice(ctx, stepTitle(8, TOTAL, "Autonomy"), FIELD_CHOICES.autonomy);
	if (!autoPick) return null;

	const codemodePick = await pickChoice(
		ctx,
		stepTitle(9, TOTAL, "Codemode"),
		FIELD_CHOICES.codemode,
		base?.codemode === undefined
			? "(default: only)"
			: base.codemode === false
				? "off"
				: base.codemode === true
					? "on"
					: "only",
	);
	if (!codemodePick) return null;

	const baseBudget = base?.budget
		? `{ ${Object.entries(base.budget)
				.map(([key, v]) => `${key}: ${String(v)}`)
				.join(", ")} }`
		: "";
	let budgetLine = baseBudget;
	for (;;) {
		const timeout = await inModal(() =>
			ctx.ui.input(
				stepTitle(10, TOTAL, "Timeout seconds (blank = default)"),
				base?.budget?.timeoutSec ? String(base.budget.timeoutSec) : "",
			),
		);
		if (timeout === undefined) return null;
		const raw = timeout.trim();
		if (raw === "") {
			budgetLine = "";
			break;
		}
		const secs = Number(raw);
		if (Number.isInteger(secs) && secs > 0) {
			budgetLine =
				raw === String(base?.budget?.timeoutSec ?? "") ? baseBudget : `{ timeoutSec: ${secs} }`;
			break;
		}
		ctx.ui.notify("Use whole seconds, e.g. 3600, or leave blank.", "warning");
	}

	const body =
		base?.systemPrompt ??
		`You are the ${name} subagent. You run in a fresh context.\n\nRules:\n- Do the task and return one short report.\n- If blocked, report back. Do not ask the user.`;
	const content = templateFromStarter(
		name,
		desc.trim() || "What it does. Use when X.",
		model,
		toolsLine,
		autoPick,
		body,
		codemodePick,
		budgetLine,
	).replace("autonomy: low", `autonomy: ${autoPick}`);
	const withLevel =
		levelPick === "(inherit)"
			? content
			: content.replace("autonomy:", `thinkingLevel: ${levelPick}\nautonomy:`);
	const created = writeSubagentFile(dir, name, withLevel);
	if ("error" in created) {
		if (created.error.includes("already exists")) {
			const retry = writeSubagentFile(
				dir,
				`${name}-2`,
				withLevel.replace(`name: ${name}`, `name: ${name}-2`),
			);
			if ("error" in retry) {
				ctx.ui.notify(retry.error, "error");
				return null;
			}
			ctx.ui.notify(`Name taken. Created ${shortPath(retry.path)}.`, "info");
			return `${name}-2`;
		}
		ctx.ui.notify(created.error, "error");
		return null;
	}
	ctx.ui.notify(`Created ${shortPath(created.path)}.`, "info");
	return name;
}
