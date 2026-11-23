/**
 * pi-subagents: what a subagent is.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export const SUBAGENT_DIR_NAME = "subagents";
export const SUBAGENT_NAME_PATTERN = /^[a-z0-9-_]+$/;
export const MAX_DESCRIPTION_CHARS = 500;
export const MAX_PROMPT_PREFIX_CHARS = 400;

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
	paths?: unknown;
	autonomy?: unknown;
	codemode?: unknown;
	mcp?: unknown;
	budget?: unknown;
	promptPrefix?: unknown;
};

export interface SubagentConfig {
	name: string;
	description: string;
	model: string;
	thinkingLevel?: ThinkingLevel;
	tools?: string[];
	// Folders this subagent may write into; undefined = no fence.
	paths?: string[];
	autonomy: SubagentAutonomy;
	// How the model meets the tools.
	codemode?: boolean | "only";
	// Open the configured MCP servers in this child; opt-in, medium+ only.
	mcp?: boolean;
	budget?: SubagentBudget;
	// Fixed framing prepended to every task this subagent gets.
	promptPrefix?: string;
	// Set only from the settings block; never from an agent file.
	finishHook?: string;
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

const SHELL_TOOLS = new Set(["bash", "powershell"]);

function withoutShell(tools: readonly string[]): string[] {
	return tools.filter((t) => !SHELL_TOOLS.has(t));
}

/**
 * Autonomy clamp: a policy, not a note.
 *
 * off/low are read-only; medium removes shell; high/inherit keep the declared
 * list, with shell removed whenever a path fence is set.
 */
export function clampToolsForAutonomy(sub: SubagentConfig): {
	tools: string[] | undefined;
	notes: string[];
} {
	const notes: string[] = [];
	const readOnly = TOOL_GROUPS["read-only"] ?? [];
	const isReadOnly =
		sub.tools !== undefined && sub.tools.length > 0 && sub.tools.every((t) => readOnly.includes(t));
	if (isReadOnly && (sub.autonomy === "medium" || sub.autonomy === "high")) {
		notes.push("read-only subagent never runs above low.");
	}
	if (sub.autonomy === "off" || sub.autonomy === "low") {
		if (!sub.tools) {
			notes.push(`autonomy ${sub.autonomy}: clamped to read-only.`);
			return { tools: [...readOnly], notes };
		}
		const allowed = new Set(readOnly);
		const clamped = sub.tools.filter((t) => allowed.has(t));
		if (clamped.length !== sub.tools.length)
			notes.push(`autonomy ${sub.autonomy}: clamped to read-only.`);
		return { tools: clamped, notes };
	}
	if (sub.autonomy === "medium") {
		const base = sub.tools ?? [...(TOOL_GROUPS.edit ?? [])];
		const clamped = withoutShell(base);
		if (clamped.length === 0) {
			notes.push("autonomy medium: no tools remain after removing shell; clamped to read-only.");
			return { tools: [...readOnly], notes };
		}
		if (clamped.length !== base.length) notes.push("autonomy medium: shell is off.");
		return { tools: clamped, notes };
	}
	const fenced = sub.paths !== undefined && sub.paths.length > 0;
	const base = sub.tools;
	if (base && fenced) {
		const clamped = withoutShell(base);
		if (clamped.length !== base.length) notes.push("paths: shell is off.");
		return { tools: clamped, notes };
	}
	if (sub.autonomy === "high") {
		notes.push("autonomy high: host permission gates do not run in subagent sessions.");
	} else if (base?.some((t) => SHELL_TOOLS.has(t))) {
		notes.push("autonomy inherit: host permission gates do not run in subagent sessions.");
	}
	return { tools: base ? [...base] : undefined, notes };
}
