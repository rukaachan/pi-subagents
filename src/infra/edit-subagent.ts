/**
 * pi-subagents: editing a subagent file without touching the rest.
 */

import * as fs from "node:fs";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { MAX_DESCRIPTION_CHARS, TOOL_GROUPS } from "../domain/subagent/config.ts";
import type { SubagentConfig } from "../domain/subagent/config.ts";
import { loadSubagentFromContent } from "./subagent-files.ts";

export const EDITABLE_FIELDS = [
	"description",
	"model",
	"thinkingLevel",
	"tools",
	"autonomy",
	"codemode",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_CHOICES: Record<EditableField, string[]> = {
	description: [],
	model: [],
	thinkingLevel: ["(inherit)", "off", "minimal", "low", "medium", "high", "xhigh", "max"],
	tools: ["all tools", "read-only", "edit", "execute", "custom…"],
	autonomy: ["inherit", "off", "low", "medium", "high"],
	codemode: ["(default: only)", "off", "on", "only"],
};

export const BUDGET_EDIT_FIELDS = [
	"timeoutSec",
	"maxTurns",
	"maxInputTokens",
	"maxReportChars",
] as const;
export type BudgetEditField = (typeof BUDGET_EDIT_FIELDS)[number];

export function validateField(field: EditableField, value: string): string | null {
	const v = value.trim();
	if (field === "description") {
		if (v.length > MAX_DESCRIPTION_CHARS) return `Description over ${MAX_DESCRIPTION_CHARS} chars.`;
		return null;
	}
	if (field === "model") {
		if (v === "inherit" || v === "") return null;
		if (!v.includes("/") || v.startsWith("/") || v.endsWith("/"))
			return 'Use "inherit" or "provider/id".';
		return null;
	}
	if (field === "thinkingLevel") {
		if (v === "" || v === "inherit" || v === "(inherit)") return null;
		if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(v)) {
			return "Use off, minimal, low, medium, high, xhigh, max, or blank.";
		}
		return null;
	}
	if (field === "tools") {
		if (v === "" || v === "all-tools" || v === "all tools") return null;
		if (TOOL_GROUPS[v]) return null;
		const known = new Set(["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"]);
		const list = v
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		if (list.length === 0) return null;
		const bad = list.filter((t) => !known.has(t) && !t.startsWith("mcp__"));
		if (bad.length > 0) return `Unknown tools: ${bad.join(", ")}.`;
		return null;
	}
	if (field === "autonomy") {
		if (["inherit", "off", "low", "medium", "high"].includes(v)) return null;
		return "Use inherit, off, low, medium, high.";
	}
	if (field === "codemode") {
		if (v === "" || v === "(default: only)") return null;
		if (["off", "on", "only", "false", "true"].includes(v)) return null;
		return "Use off, on, only, or (default: only).";
	}
	return null;
}

export function editSubagentField(
	filePath: string,
	field: EditableField,
	value: string,
): string | null {
	const err = validateField(field, value);
	if (err) return err;
	const read = readFile(filePath);
	if ("error" in read) return read.error;
	const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(read.text);
	const v = value.trim();
	const clearWord = v === "" || v === "(inherit)" || v === "all tools" || v === "(default: only)";
	if (clearWord && (field === "thinkingLevel" || field === "tools" || field === "codemode")) {
		delete frontmatter[field];
	} else if (field === "tools" && v === "all-tools") {
		delete frontmatter[field];
	} else if (field === "tools" && !TOOL_GROUPS[v] && v.includes(",")) {
		frontmatter[field] = v
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
	} else {
		frontmatter[field] = v;
	}
	return writeFrontmatter(filePath, frontmatter, body);
}

export function currentBudgetValue(sub: SubagentConfig, field: BudgetEditField): string {
	const value = sub.budget?.[field];
	return value === undefined ? "" : String(value);
}

export function editBudgetField(
	filePath: string,
	field: BudgetEditField,
	value: string,
): string | null {
	const v = value.trim();
	if (v !== "") {
		const n = Number(v);
		if (!Number.isInteger(n) || n < 0) return "Use a whole number >= 0, or blank to clear.";
	}
	const read = readFile(filePath);
	if ("error" in read) return read.error;
	const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(read.text);
	const raw = frontmatter.budget;
	const budget: Record<string, unknown> =
		raw && typeof raw === "object" && !Array.isArray(raw)
			? { ...(raw as Record<string, unknown>) }
			: {};
	if (v === "") delete budget[field];
	else budget[field] = Number(v);
	if (Object.keys(budget).length === 0) delete frontmatter.budget;
	else frontmatter.budget = budget;
	return writeFrontmatter(filePath, frontmatter, body);
}

function readFile(filePath: string): { text: string } | { error: string } {
	try {
		return { text: fs.readFileSync(filePath, "utf-8") };
	} catch {
		return { error: `Cannot read ${filePath}.` };
	}
}

function writeFrontmatter(
	filePath: string,
	frontmatter: Record<string, unknown>,
	body: string,
): string | null {
	const lines = ["---"];
	for (const [k, val] of Object.entries(frontmatter)) {
		if (Array.isArray(val)) lines.push(`${k}: [${val.join(", ")}]`);
		else if (val !== null && typeof val === "object") {
			const inner = Object.entries(val as Record<string, unknown>)
				.map(([key, v]) => `${key}: ${String(v)}`)
				.join(", ");
			lines.push(`${k}: { ${inner} }`);
		} else lines.push(`${k}: ${String(val)}`);
	}
	lines.push("---", "", body.trim(), "");
	const next = lines.join("\n");
	const parsed = loadSubagentFromContent(next, filePath, "user");
	if (typeof parsed === "string") return `Edit invalid: ${parsed}`;
	fs.writeFileSync(filePath, next, "utf-8");
	return null;
}
