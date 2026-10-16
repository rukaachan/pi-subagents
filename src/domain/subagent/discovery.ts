/**
 * pi-subagents: the rules that decide and suggest.
 */

import type { SubagentBudget } from "./budget.ts";
import type { SubagentConfig } from "./config.ts";

export interface SubagentDiscoveryResult {
	subagents: SubagentConfig[];
	errors: string[];
	userSubagentsDir: string;
	projectSubagentsDir: string | null;
}

// Edit distance (Wagner-Fischer, one row).
function editDistance(a: string, b: string): number {
	const n = b.length;
	let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		let diag = prev[0] ?? n + i;
		prev[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const keep = prev[j] ?? a.length + n;
			prev[j] = Math.min(
				(prev[j] ?? 0) + 1,
				(prev[j - 1] ?? 0) + 1,
				diag + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
			diag = keep;
		}
	}
	return prev[n] ?? a.length + n;
}

export function suggestSubagentName(input: string, names: string[]): string | null {
	let best: string | null = null;
	let bestDist = 3;
	for (const n of names) {
		const d = editDistance(input.toLowerCase(), n.toLowerCase());
		if (d < bestDist) {
			bestDist = d;
			best = n;
		}
	}
	return bestDist <= 2 ? best : null;
}

// Apply the report-characters budget to a run's output text.
export function applyReportBudget(text: string, budget: SubagentBudget | undefined): string {
	if (!budget || !budget.maxReportChars) return text;
	const cap = budget.maxReportChars;
	if (text.length <= cap) return text;
	const gone = text.length - cap;
	const marker = `\n\n[truncated: ${gone} characters over the ${cap}-char budget]`;
	if (marker.length >= cap) return marker.slice(0, cap);
	return text.slice(0, cap - marker.length) + marker;
}
