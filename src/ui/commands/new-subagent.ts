/**
 * pi-subagents: quick and full paths for creating a subagent.
 */

import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_DIR_NAME } from "../../domain/subagent/index.ts";
import { discoverSubagents } from "../../infra/files/index.ts";
import { templateFromStarter, validateName, writeSubagentFile } from "../../infra/files/index.ts";
import { inModal } from "../../app/stop/index.ts";
import { pickFromList } from "../index.ts";
import { runCreateWizard } from "../menu/root/index.ts";
import { shortPath, stepTitle } from "../view/text/index.ts";

export interface QuickSubagentFields {
	name: string;
	description: string;
	prompt: string;
}

export type QuickSubagentResult =
	| { ok: true; name: string; path: string }
	| { ok: false; error: string };

function quickBody(fields: QuickSubagentFields): string {
	return (
		fields.prompt.trim() ||
		`You are the ${fields.name} subagent. You run in a fresh context.\n\nRules:\n- Do the task and return one short report.\n- If blocked, report back. Do not ask the user.`
	);
}

export function createQuickSubagent(dir: string, fields: QuickSubagentFields): QuickSubagentResult {
	const name = fields.name.trim();
	const bad = validateName(name);
	if (bad) return { ok: false, error: bad };
	const content = templateFromStarter(
		name,
		fields.description.trim() || "What it does. Use when X.",
		"inherit",
		"read-only",
		"low",
		quickBody({ ...fields, name }),
	);
	const created = writeSubagentFile(dir, name, content);
	if (!("error" in created)) return { ok: true, name, path: created.path };
	if (!created.error.includes("already exists")) return { ok: false, error: created.error };
	const retryName = `${name}-2`;
	const retry = writeSubagentFile(
		dir,
		retryName,
		content.replace(`name: ${name}`, `name: ${retryName}`),
	);
	if ("error" in retry) return { ok: false, error: retry.error };
	return { ok: true, name: retryName, path: retry.path };
}

async function pickDir(
	ctx: ExtensionCommandContext,
	userSubagentsDir: string,
	total: number,
): Promise<string | null> {
	const loc = await pickFromList(ctx, {
		title: stepTitle(1, total, "Location"),
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
	if (loc === "personal") return userSubagentsDir;
	if (!ctx.isProjectTrusted()) {
		ctx.ui.notify("Project not trusted. Trust it first, then retry.", "error");
		return null;
	}
	const found = discoverSubagents(ctx.cwd);
	return found.projectSubagentsDir ?? path.join(ctx.cwd, CONFIG_DIR_NAME, SUBAGENT_DIR_NAME);
}

async function runQuickCreateWizard(
	ctx: ExtensionCommandContext,
	userSubagentsDir: string,
): Promise<string | null> {
	const TOTAL = 4;
	const dir = await pickDir(ctx, userSubagentsDir, TOTAL);
	if (!dir) return null;

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

	const desc = await inModal(() =>
		ctx.ui.input(stepTitle(3, TOTAL, "Description"), "What it does. Use when X."),
	);
	if (desc === undefined) return null;

	const prompt = await inModal(() =>
		ctx.ui.input(
			stepTitle(4, TOTAL, "Prompt"),
			"Do the task. Return one short report. If blocked, report back.",
		),
	);
	if (prompt === undefined) return null;

	const created = createQuickSubagent(dir, { name, description: desc, prompt });
	if (!created.ok) {
		ctx.ui.notify(created.error, "error");
		return null;
	}
	const renamed = created.name === name ? "" : " Name taken; created a numbered copy.";
	ctx.ui.notify(
		`Created ${shortPath(created.path)}.${renamed}\n/subagents ${created.name} opens it for editing.`,
		"info",
	);
	return created.name;
}

export async function runNewSubagent(
	ctx: ExtensionCommandContext,
	userSubagentsDir: string,
): Promise<string | null> {
	const mode = await pickFromList(ctx, {
		title: "New subagent",
		subtitle: "pick the short path or the full settings",
		items: [
			{
				value: "quick",
				label: "Quick create",
				description: "location, name, description, prompt",
			},
			{
				value: "full",
				label: "Full settings",
				description: "model, tools, thinking, autonomy, codemode, budget",
			},
		],
	});
	if (!mode) return null;
	if (mode === "full") return runCreateWizard(ctx, userSubagentsDir);
	return runQuickCreateWizard(ctx, userSubagentsDir);
}
