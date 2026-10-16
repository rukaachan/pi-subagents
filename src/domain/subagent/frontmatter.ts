/**
 * pi-subagents: validating a subagent file.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { parseBudget } from "./budget.ts";
import {
	KNOWN_TOOLS,
	MAX_DESCRIPTION_CHARS,
	SUBAGENT_NAME_PATTERN,
	THINKING_LEVELS,
	resolveToolPolicy,
	showValue,
} from "./config.ts";
import type {
	SubagentAutonomy,
	SubagentConfig,
	SubagentFrontmatter,
	SubagentSource,
} from "./config.ts";

export function validateSubagent(
	frontmatter: SubagentFrontmatter,
	body: string,
	source: SubagentSource,
	filePath: string,
): SubagentConfig | string {
	const warnings: string[] = [];

	const name = frontmatter.name;
	if (typeof name !== "string" || !name) return "missing required field: name.";
	if (!SUBAGENT_NAME_PATTERN.test(name)) return `invalid name "${name}". Use ^[a-z0-9-_]+$.`;

	const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
	if (!description) warnings.push("missing description.");
	else if (description.length > MAX_DESCRIPTION_CHARS) {
		warnings.push(`description over ${MAX_DESCRIPTION_CHARS} chars.`);
	}

	const model =
		typeof frontmatter.model === "string" && frontmatter.model ? frontmatter.model : "inherit";

	let thinkingLevel: ThinkingLevel | undefined;
	const rawThinking = frontmatter.thinkingLevel ?? frontmatter.reasoningEffort;
	if (rawThinking !== undefined && rawThinking !== null && rawThinking !== "") {
		if (typeof rawThinking !== "string" || !THINKING_LEVELS.has(rawThinking)) {
			return `invalid thinkingLevel "${showValue(rawThinking)}". Use off, minimal, low, medium, high, xhigh, max.`;
		}
		thinkingLevel = rawThinking as ThinkingLevel;
		if (model === "inherit") warnings.push("thinkingLevel is ignored when model is inherit.");
	}

	let tools: string[] | undefined;
	try {
		tools = resolveToolPolicy(frontmatter.tools);
	} catch (err) {
		return err instanceof Error ? err.message : "invalid tools value.";
	}
	if (tools) {
		const known = tools;
		const unknown = known.filter((t) => !KNOWN_TOOLS.has(t) && !t.startsWith("mcp__"));
		if (unknown.length > 0) return `unknown tools: ${unknown.join(", ")}.`;
		const dupes = known.filter((t, i) => known.indexOf(t) !== i);
		if (dupes.length > 0) warnings.push(`duplicate tools: ${[...new Set(dupes)].join(", ")}.`);
	}

	const autonomyRaw = frontmatter.autonomy;
	let autonomy: SubagentAutonomy = "inherit";
	if (autonomyRaw !== undefined && autonomyRaw !== null && autonomyRaw !== "") {
		if (
			autonomyRaw !== "inherit" &&
			autonomyRaw !== "off" &&
			autonomyRaw !== "low" &&
			autonomyRaw !== "medium" &&
			autonomyRaw !== "high"
		) {
			return `invalid autonomy "${showValue(autonomyRaw)}". Use inherit, off, low, medium, high.`;
		}
		autonomy = autonomyRaw;
	}

	const systemPrompt = body.trim();
	if (!systemPrompt) return "empty system prompt body.";

	const codemode = parseCodemodeFlag(frontmatter.codemode);
	if (codemode.error) return codemode.error;

	const budget = parseBudget(frontmatter.budget);
	if (typeof budget === "string") return budget;

	return {
		name,
		description,
		model,
		thinkingLevel,
		tools,
		autonomy,
		codemode:
			codemode.mode === true || codemode.mode === false || codemode.mode === "only"
				? codemode.mode
				: undefined,
		budget,
		systemPrompt,
		source,
		filePath,
		warnings,
	};
}

export interface CodemodeFlag {
	mode: boolean | "only" | undefined;
	error?: string;
}

export function parseCodemodeFlag(raw: unknown): CodemodeFlag {
	if (raw === undefined || raw === null || raw === "") return { mode: undefined };
	if (raw === true || raw === "on") return { mode: true };
	if (raw === false || raw === "off") return { mode: false };
	if (raw === "only") return { mode: "only" };
	return {
		mode: undefined,
		error: `invalid codemode ${showValue(raw)}. Use off, on, only, true, false, or drop the field.`,
	};
}
