/**
 * pi-subagents: the operator's policy for every subagent.
 */

import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { KNOWN_TOOLS, resolveToolPolicy } from "../domain/subagent/config.ts";
import type { SubagentAutonomy, SubagentConfig } from "../domain/subagent/config.ts";
import { parseCodemodeFlag } from "../domain/subagent/frontmatter.ts";
import { parseBudget } from "../domain/subagent/budget.ts";
import type { SubagentBudget } from "../domain/subagent/budget.ts";

export interface GlobalConfig {
	codemode?: boolean | "only";
	model?: string;
	tools?: string[];
	autonomy?: SubagentAutonomy;
	budget?: SubagentBudget;
}

const AUTONOMY: readonly string[] = ["inherit", "off", "low", "medium", "high"];

export function readGlobalConfig(cwd: string, agentDir: string = getAgentDir()): GlobalConfig {
	try {
		const settings = SettingsManager.create(cwd, agentDir).getSettings() as Record<string, unknown>;
		const block = settings["pi-subagents"];
		if (!block || typeof block !== "object" || Array.isArray(block)) return {};
		const raw = block as Record<string, unknown>;
		const out: GlobalConfig = {};
		const codemode = parseCodemodeFlag(raw.codemode);
		if (!codemode.error && codemode.mode !== undefined) out.codemode = codemode.mode;
		if (typeof raw.model === "string" && raw.model.trim()) out.model = raw.model.trim();
		if (raw.tools !== undefined) {
			try {
				const tools = resolveToolPolicy(raw.tools);
				const unknown = (tools ?? []).filter((t) => !KNOWN_TOOLS.has(t) && !t.startsWith("mcp__"));
				if (tools && unknown.length === 0) out.tools = tools;
			} catch {
				/* an invalid tools value is ignored, not fatal */
			}
		}
		if (typeof raw.autonomy === "string" && AUTONOMY.includes(raw.autonomy)) {
			out.autonomy = raw.autonomy as SubagentAutonomy;
		}
		const budget = parseBudget(raw.budget);
		if (budget && typeof budget !== "string") out.budget = budget;
		return out;
	} catch {
		return {};
	}
}

/** Settings win over the file; a per-run Task switch still wins over both. */
export function withGlobalConfig(sub: SubagentConfig, global: GlobalConfig): SubagentConfig {
	const next: SubagentConfig = { ...sub };
	if (global.codemode !== undefined) next.codemode = global.codemode;
	if (global.model) next.model = global.model;
	if (global.tools) next.tools = [...global.tools];
	if (global.autonomy) next.autonomy = global.autonomy;
	if (global.budget) next.budget = { ...sub.budget, ...global.budget };
	return next;
}
