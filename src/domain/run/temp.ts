/**
 * pi-subagents: session-temporary subagents.
 */

import type { SubagentBudget } from "../subagent/index.ts";
import type { SubagentConfig } from "../subagent/index.ts";
import type { SubagentDiscoveryResult } from "../subagent/index.ts";
import { parseBudget } from "../subagent/index.ts";
import { parsePaths } from "../subagent/index.ts";

export const MAX_TEMP_PROMPT_LINES = 20;
export const MAX_TEMP_PROMPT_LINE_CHARS = 120;

export const MAX_TEMP_DESC_CHARS = 200;

const NAME_RE = /^[a-z][a-z0-9-]{1,31}$/;

export type TempRegistration =
	| { ok: true; sub: SubagentConfig; replaced: boolean }
	| { ok: false; error: string };

const registry = new Map<string, SubagentConfig>();

export function getTempSubagents(): SubagentConfig[] {
	return [...registry.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

// Merge disk discovery with the session-temp registry.
export function withTemps(discovery: SubagentDiscoveryResult): SubagentDiscoveryResult {
	const temps = getTempSubagents().filter(
		(t) => !discovery.subagents.some((d) => d.name === t.name),
	);
	if (temps.length === 0) return discovery;
	return {
		...discovery,
		subagents: [...discovery.subagents, ...temps].toSorted((a, b) => a.name.localeCompare(b.name)),
	};
}

// Validate + register (or replace) a session-temp subagent.
function parseTempCodemode(raw: unknown): boolean | "only" | undefined | "bad" {
	if (raw === undefined || raw === null || raw === "") return undefined;
	if (raw === true || raw === "on") return true;
	if (raw === false || raw === "off") return false;
	if (raw === "only") return "only";
	return "bad";
}

export function registerTemp(
	raw: unknown,
	persistentNames: readonly string[],
	activeTools?: readonly string[],
): TempRegistration {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return {
			ok: false,
			error:
				"temp_definition must be an object { name, description, systemPrompt, model?, tools?, codemode?, budget? }.",
		};
	}
	const d = raw as Record<string, unknown>;

	const rawName = typeof d.name === "string" ? d.name.trim() : "";
	if (!NAME_RE.test(rawName)) {
		const lowered = rawName.toLowerCase();
		const usable = lowered !== rawName && NAME_RE.test(lowered);
		return {
			ok: false,
			error: usable
				? `name "${rawName}" — use the exact lowercase form "${lowered}".`
				: "name must be lowercase letters, digits or hyphens (2-32 chars, starting with a letter).",
		};
	}
	const name = rawName;
	if (persistentNames.some((n) => n.toLowerCase() === name)) {
		return {
			ok: false,
			error: `name "${name}" is a persistent starter. Temps never shadow one on disk — pick another name.`,
		};
	}

	const description = d.description;
	if (typeof description !== "string" || description.trim().length === 0) {
		return { ok: false, error: "description must be a non-empty string (one line shown in rows)." };
	}
	if (description.length > MAX_TEMP_DESC_CHARS) {
		return {
			ok: false,
			error: `description is ${description.length} characters; keep it at most ${MAX_TEMP_DESC_CHARS}.`,
		};
	}

	const prompt = d.systemPrompt;
	if (typeof prompt !== "string" || prompt.trim().length === 0) {
		return {
			ok: false,
			error: "systemPrompt must be a non-empty string — it is the temp's contract.",
		};
	}
	const lines = prompt.split("\n");
	if (lines.length > MAX_TEMP_PROMPT_LINES) {
		return {
			ok: false,
			error: `systemPrompt has ${lines.length} lines; a temp prompt takes at most ${MAX_TEMP_PROMPT_LINES} lines.`,
		};
	}
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.length > MAX_TEMP_PROMPT_LINE_CHARS) {
			return {
				ok: false,
				error: `systemPrompt line ${i + 1} runs to ${line.length} characters; the cap is ${MAX_TEMP_PROMPT_LINE_CHARS} per line.`,
			};
		}
	}

	const modelRaw = d.model;
	if (modelRaw !== undefined && (typeof modelRaw !== "string" || modelRaw.trim() === "")) {
		return { ok: false, error: "model must be a string: provider/id, or inherit." };
	}
	const model = modelRaw === undefined || modelRaw === "" ? "inherit" : modelRaw.trim();

	const codemode = parseTempCodemode(d.codemode);
	if (codemode === "bad") {
		return { ok: false, error: 'codemode must be off, on, "only", true, false, or omitted.' };
	}
	if (d.tools !== undefined) {
		if (!Array.isArray(d.tools) || d.tools.some((t) => typeof t !== "string" || t.trim() === "")) {
			return {
				ok: false,
				error: "tools must be an array of non-empty tool-id strings, or omit for all tools.",
			};
		}
	}

	if (d.tools !== undefined && activeTools) {
		const outside = (d.tools as string[]).filter((t) => !activeTools.includes(t));
		if (outside.length > 0) {
			return {
				ok: false,
				error: `tools not active in this session: ${outside.join(", ")}. A temp can narrow tools, never widen them.`,
			};
		}
	}

	const parsedPaths = parsePaths(d.paths);
	if (!parsedPaths.ok) return { ok: false, error: parsedPaths.error };

	const parsedBudget = parseBudget(d.budget);
	if (typeof parsedBudget === "string") return { ok: false, error: parsedBudget };
	const budget: SubagentBudget | undefined = parsedBudget;

	const tools: string[] | undefined =
		d.tools === undefined ? undefined : (d.tools as unknown[]).map((t) => t as string);

	const sub: SubagentConfig = {
		name,
		description,
		model,
		tools,
		paths: parsedPaths.paths.length > 0 ? parsedPaths.paths : undefined,
		autonomy: "inherit",
		codemode,
		budget,
		systemPrompt: prompt,
		source: "temp",
		filePath: "(session temp)",
		warnings: [],
	};

	const replaced = registry.has(name);
	registry.set(name, sub);
	return { ok: true, sub, replaced };
}
