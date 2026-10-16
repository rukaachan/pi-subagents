/**
 * pi-subagents: run ceilings.
 */
import { showValue, type SubagentBudget } from "./config.ts";

export type { SubagentBudget };

export const DEFAULT_TIMEOUT_SEC = 3600;

export function effectiveBudget(budget: SubagentBudget | undefined): SubagentBudget {
	if (budget === undefined) return { timeoutSec: DEFAULT_TIMEOUT_SEC };
	if (budget.timeoutSec !== undefined) return budget;
	if (Object.keys(budget).length === 0) return budget;
	return { ...budget, timeoutSec: DEFAULT_TIMEOUT_SEC };
}

export const BUDGET_FIELDS = [
	"maxTurns",
	"maxInputTokens",
	"timeoutSec",
	"maxReportChars",
] as const;

export function parseBudget(raw: unknown): SubagentBudget | undefined | string {
	if (raw === undefined || raw === null || raw === "") return undefined;
	if (typeof raw !== "object" || Array.isArray(raw)) {
		return `invalid budget ${showValue(raw)}. Use { ${BUDGET_FIELDS.join(": N, ")}: N }.`;
	}
	const o = raw as Record<string, unknown>;
	const out: SubagentBudget = {};
	for (const key of Object.keys(o)) {
		if (!(BUDGET_FIELDS as readonly string[]).includes(key)) {
			return `unknown budget field "${key}". Use ${BUDGET_FIELDS.join(", ")}.`;
		}
		const v = o[key];
		if (typeof v === "number" && Number.isInteger(v) && v >= 0) {
			out[key as keyof SubagentBudget] = v;
			continue;
		}
		if (v === undefined || v === null) continue;
		return `invalid budget.${key} ${showValue(v)}. Use a non-negative integer (0 = off).`;
	}
	// `{ }` stays `{ }`.
	if (Object.keys(out).length === 0) return {};
	return out;
}

export function applyReportBudget(text: string, budget: SubagentBudget | undefined): string {
	if (!budget || !budget.maxReportChars) return text;
	const cap = budget.maxReportChars;
	if (text.length <= cap) return text;
	const gone = text.length - cap;
	const marker = `\n\n[truncated: ${gone} characters over the ${cap}-char budget]`;
	if (marker.length >= cap) return marker.slice(0, cap);
	return text.slice(0, cap - marker.length) + marker;
}
