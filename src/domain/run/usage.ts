/**
 * pi-subagents: the usage shape a run reports.
 */

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export interface UsageEnd {
	inputTokens?: number;
	outputTokens?: number;
	cost?: number;
}

interface CostLike {
	input: number;
	output: number;
	cost: number | { total: number };
}

export function usageEnd(usage: CostLike | undefined): UsageEnd {
	if (!usage) return {};
	const cost = typeof usage.cost === "number" ? usage.cost : usage.cost.total;
	return { inputTokens: usage.input, outputTokens: usage.output, cost };
}
