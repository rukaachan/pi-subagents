/**
 * pi-subagents: subagent files on disk.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_DIR_NAME, SUBAGENT_NAME_PATTERN } from "../domain/subagent/config.ts";
import { loadSubagentFromContent } from "./subagent-files.ts";

export {
	BUDGET_EDIT_FIELDS,
	EDITABLE_FIELDS,
	FIELD_CHOICES,
	currentBudgetValue,
	editBudgetField,
	editSubagentField,
	validateField,
} from "./edit-subagent.ts";
export type { BudgetEditField, EditableField } from "./edit-subagent.ts";

export function subagentTemplate(name: string): string {
	return [
		"---",
		`name: ${name}`,
		"description: What it does. Use when X.",

		"model: inherit",
		"tools: read-only",
		"autonomy: low",
		"---",
		"",
		`You are the ${name} subagent. You run in a fresh context.`,
		"",
		"Rules:",
		"- Do the task and return one short report.",
		"- If blocked, report back. Do not ask the user.",
		"",
	].join("\n");
}

export function templateFromStarter(
	name: string,
	description: string,
	model: string,
	toolsLine: string,

	autonomy: string,
	body: string,
	codemode?: string,
	budgetLine?: string,
): string {
	const toolsRow = toolsLine ? `tools: ${toolsLine}` : "# tools omitted = all";
	const codemodeRow = codemode && codemode !== "(default: only)" ? `codemode: ${codemode}` : null;
	const budgetRow = budgetLine ? `budget: ${budgetLine}` : null;
	return [
		"---",
		`name: ${name}`,
		`description: ${description}`,
		`model: ${model}`,
		toolsRow,
		`autonomy: ${autonomy}`,
		...(codemodeRow ? [codemodeRow] : []),
		...(budgetRow ? [budgetRow] : []),
		"---",
		"",
		body.trim(),
		"",
	].join("\n");
}

export function validateName(name: string): string | null {
	if (!SUBAGENT_NAME_PATTERN.test(name)) return `Invalid name "${name}". Use ^[a-z0-9-_]+$.`;
	return null;
}

export function writeSubagentFile(
	dir: string,
	name: string,
	content: string,
): { path: string } | { error: string } {
	const bad = validateName(name);
	if (bad) return { error: bad };
	fs.mkdirSync(dir, { recursive: true });
	const filePath = path.join(dir, `${name}.md`);
	if (fs.existsSync(filePath))
		return { error: `Subagent "${name}" already exists at ${filePath}.` };
	const parsed = loadSubagentFromContent(
		content,
		filePath,
		dir.includes(".pi") ? "project" : "user",
	);
	if (typeof parsed === "string") return { error: `Template invalid: ${parsed}` };
	fs.writeFileSync(filePath, content, "utf-8");
	return { path: filePath };
}

export function createSubagentFile(
	dir: string,
	name: string,
): { path: string } | { error: string } {
	return writeSubagentFile(dir, name, subagentTemplate(name));
}

export function trashDir(): string {
	return path.join(getAgentDir(), SUBAGENT_DIR_NAME, ".trash");
}
