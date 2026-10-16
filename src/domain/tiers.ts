/**
 * pi-subagents: per-run overrides.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { SubagentBudget } from "./subagent/budget.ts";
import type { SubagentConfig } from "./subagent/config.ts";

export type Complexity = "light" | "medium" | "heavy";

export const COMPLEXITY_TIERS: readonly Complexity[] = ["light", "medium", "heavy"] as const;

const TIER_THINKING: Record<Complexity, ThinkingLevel> = {
	light: "low",
	medium: "medium",
	heavy: "high",
};

export function parseComplexity(value: unknown): Complexity | null | "bad" {
	if (value === undefined || value === null || value === "") return null;
	if (typeof value !== "string") return "bad";
	const one = value.trim().toLowerCase();
	return (COMPLEXITY_TIERS as readonly string[]).includes(one) ? (one as Complexity) : "bad";
}

export type CodemodeOverride = boolean | "only";

export interface RunOverrides {
	model?: string;
	complexity?: Complexity | null;
	budget?: SubagentBudget | Record<string, never>;
	codemode?: CodemodeOverride;
}

export function parseCodemodeOverride(value: unknown): CodemodeOverride | null | "bad" {
	if (value === undefined || value === null || value === "") return null;
	if (value === true || value === false || value === "only") return value;
	if (value === "on") return true;
	if (value === "off") return false;
	return "bad";
}

export function hasOverrides(o: RunOverrides): boolean {
	return (
		Boolean(o.model) || Boolean(o.complexity) || o.budget !== undefined || o.codemode !== undefined
	);
}

export function applyRunOverrides(sub: SubagentConfig, o: RunOverrides): SubagentConfig {
	if (!hasOverrides(o)) return sub;
	const next: SubagentConfig = { ...sub };
	if (o.model) next.model = o.model;
	if (o.codemode !== undefined) next.codemode = o.codemode;
	if (o.budget !== undefined) {
		// Merge, never replace.
		const given = o.budget as SubagentBudget;
		next.budget = Object.keys(given).length === 0 ? {} : { ...sub.budget, ...given };
	}
	if (o.complexity && !sub.thinkingLevel) next.thinkingLevel = TIER_THINKING[o.complexity];
	if (o.complexity && sub.thinkingLevel) next.warnings = [...sub.warnings];
	return next;
}

export function overrideNote(o: RunOverrides): string {
	const bits: string[] = [];
	if (o.complexity) bits.push(`complexity ${o.complexity}`);
	if (o.model) bits.push(`model ${o.model}`);
	if (o.codemode !== undefined) {
		bits.push(`codemode ${o.codemode === false ? "off" : o.codemode === true ? "on" : "only"}`);
	}
	if (o.budget !== undefined) {
		const b = o.budget as SubagentBudget;
		const parts = [
			b.maxTurns ? `${b.maxTurns} turns` : null,
			b.maxInputTokens ? `${b.maxInputTokens} in-tok` : null,
			b.timeoutSec ? `${b.timeoutSec}s timeout` : null,
			b.maxReportChars ? `${b.maxReportChars} chars` : null,
		].filter((x): x is string => x !== null);
		const text = parts.length > 0 ? parts.join(" / ") : "none";
		bits.push(`budget ${text}`);
	}
	return bits.join(" · ");
}
