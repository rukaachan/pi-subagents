/**
 * pi-subagents: what a subagent is.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export const SUBAGENT_DIR_NAME = "subagents";
export const SUBAGENT_NAME_PATTERN = /^[a-z0-9-_]+$/;
export const MAX_DESCRIPTION_CHARS = 500;

export type SubagentSource = "user" | "project" | "temp";
export type SubagentAutonomy = "inherit" | "off" | "low" | "medium" | "high";

/** Pi tool groups (locked Q12). Omit `tools` = allow all. */
export const TOOL_GROUPS: Record<string, string[]> = {
	"read-only": ["read", "grep", "find", "ls"],
	edit: ["read", "grep", "find", "ls", "edit", "write"],
	execute: ["read", "grep", "find", "ls", "edit", "write", "bash"],
};

/** Built-in Pi tools a subagent may name. */
export const KNOWN_TOOLS = new Set([
	"read",
	"bash",
	"powershell",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"codemode",
]);

export function showValue(v: unknown): string {
	return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
}

export const THINKING_LEVELS: ReadonlySet<string> = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

export interface SubagentBudget {
	maxTurns?: number;
	// Stop the run once summed input tokens pass this line.
	maxInputTokens?: number;
	timeoutSec?: number;
	maxReportChars?: number;
}

export type SubagentFrontmatter = {
	name?: unknown;
	description?: unknown;
	model?: unknown;
	thinkingLevel?: unknown;
	reasoningEffort?: unknown;
	tools?: unknown;
	autonomy?: unknown;
	codemode?: unknown;
	budget?: unknown;
};

export interface SubagentConfig {
	name: string;
	description: string;
	model: string;
	thinkingLevel?: ThinkingLevel;
	tools?: string[];
	autonomy: SubagentAutonomy;
	// How the model meets the tools.
	codemode?: boolean | "only";
	budget?: SubagentBudget;
	systemPrompt: string;
	source: SubagentSource;
	filePath: string;
	warnings: string[];
}

function parseToolList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = raw
		.filter((t): t is string => typeof t === "string")
		.map((t) => t.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

/** Resolve `tools` frontmatter to an allowlist. undefined = allow all. Throws on invalid. */
export function resolveToolPolicy(value: unknown): string[] | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (value === "all")
		throw new Error('tools: "all" is rejected. Omit the tools field to allow every tool.');
	if (typeof value === "string") {
		const group = TOOL_GROUPS[value.trim()];
		if (group) return [...group];
		const single = parseToolList(value);
		if (single) return single;
		throw new Error(
			`Unknown tools value "${value}". Use read-only, edit, execute, or a tool list.`,
		);
	}
	const list = parseToolList(value);
	if (list) return list;
	throw new Error("Invalid tools value. Use a group name or a list of tool IDs.");
}

/** Autonomy clamp: off = read tools only; read-only subagent never runs above low. */
export function clampToolsForAutonomy(sub: SubagentConfig): {
	tools: string[] | undefined;
	notes: string[];
} {
	const notes: string[] = [];
	const readOnly = TOOL_GROUPS["read-only"] ?? [];
	if (sub.autonomy === "off") {
		if (!sub.tools)
			return {
				tools: [...readOnly],
				notes: ["autonomy off: clamped to read-only."],
			};
		const allowed = new Set(readOnly);
		const clamped = sub.tools.filter((t) => allowed.has(t));
		if (clamped.length !== sub.tools.length) notes.push("autonomy off: clamped to read-only.");
		return { tools: clamped, notes };
	}
	const isReadOnly =
		sub.tools !== undefined && sub.tools.length > 0 && sub.tools.every((t) => readOnly.includes(t));
	if (isReadOnly && (sub.autonomy === "medium" || sub.autonomy === "high")) {
		notes.push("read-only subagent never runs above low.");
	}
	if (sub.autonomy === "medium" || sub.autonomy === "high") {
		notes.push(
			`autonomy ${sub.autonomy}: runs with tool policy only; full confirm gates land in v3.`,
		);
	}
	return { tools: sub.tools ? [...sub.tools] : undefined, notes };
}
