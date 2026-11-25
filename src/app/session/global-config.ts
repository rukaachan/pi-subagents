/**
 * pi-subagents: the operator's policy for every subagent.
 */

import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { KNOWN_TOOLS, resolveToolPolicy } from "../../domain/subagent/index.ts";
import type { SubagentAutonomy, SubagentConfig } from "../../domain/subagent/index.ts";
import { parseCodemodeFlag } from "../../domain/subagent/index.ts";
import { parseBudget } from "../../domain/subagent/index.ts";
import type { SubagentBudget } from "../../domain/subagent/index.ts";

export const MIN_LIVE_CAP = 1;
export const MAX_LIVE_CAP = 64;
export const MAX_FINISH_HOOK_CHARS = 1000;

export interface GlobalConfig {
	codemode?: boolean | "only";
	model?: string;
	tools?: string[];
	autonomy?: SubagentAutonomy;
	budget?: SubagentBudget;
	/** Live subagent legs; invalid values fall back to MAX_LIVE_TASKS. */
	liveCap?: number;
	/** Command run once per finished run; never read from an agent file. */
	finishHook?: string;
	/** Whether the `subagent` compatibility alias registers. Default true. */
	alias?: boolean;
	/** Wake the parent when a background leg settles. Default true. */
	settleNotify?: boolean;
}

const AUTONOMY: readonly string[] = ["inherit", "off", "low", "medium", "high"];

export function readGlobalConfig(
	cwd: string,
	agentDir: string = getAgentDir(),
	opts: { trusted?: boolean } = {},
): GlobalConfig {
	try {
		const manager = SettingsManager.create(cwd, agentDir);
		const settings = manager.getSettings() as Record<string, unknown>;
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
		const liveCap = parseLiveCap(raw.liveCap);
		if (liveCap !== undefined) out.liveCap = liveCap;
		const hookSource = opts.trusted
			? raw
			: ((manager.getGlobalSettings() as Record<string, unknown>)["pi-subagents"] as
					| Record<string, unknown>
					| undefined);
		const finishHook = parseFinishHook(hookSource?.finishHook);
		if (finishHook) out.finishHook = finishHook;
		if (raw.alias === false || raw.alias === "off") out.alias = false;
		else if (raw.alias === true || raw.alias === "on") out.alias = true;
		if (raw.settleNotify === false || raw.settleNotify === "off") out.settleNotify = false;
		else if (raw.settleNotify === true || raw.settleNotify === "on") out.settleNotify = true;
		return out;
	} catch {
		return {};
	}
}

export function parseLiveCap(value: unknown): number | undefined {
	const n =
		typeof value === "number"
			? value
			: typeof value === "string" && /^\d+$/.test(value.trim())
				? Number(value)
				: Number.NaN;
	return Number.isInteger(n) && n >= MIN_LIVE_CAP && n <= MAX_LIVE_CAP ? n : undefined;
}

export function parseFinishHook(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const command = value.trim();
	if (!command || command.length > MAX_FINISH_HOOK_CHARS) return undefined;
	return command;
}

/**
 * Whether the `subagent` alias should register.
 *
 * Read once at extension load, so changing it needs `/reload`. The default is
 * on: models that only know Pi's sample `subagent` tool keep working.
 */
export function aliasEnabled(cwd: string, agentDir: string = getAgentDir()): boolean {
	return readGlobalConfig(cwd, agentDir).alias !== false;
}

/** Settings win over the file; a per-run Task switch still wins over both. */
export function withGlobalConfig(sub: SubagentConfig, global: GlobalConfig): SubagentConfig {
	const next: SubagentConfig = { ...sub };
	if (global.codemode !== undefined) next.codemode = global.codemode;
	if (global.model) next.model = global.model;
	if (global.tools) next.tools = [...global.tools];
	if (global.autonomy) next.autonomy = global.autonomy;
	if (global.budget) next.budget = { ...sub.budget, ...global.budget };
	if (global.finishHook) next.finishHook = global.finishHook;
	return next;
}
