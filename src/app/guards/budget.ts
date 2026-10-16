/**
 * pi-subagents: the budget clock and its counters.
 */

export function turnInputTokens(event: { type: string }): number | undefined {
	const usage = (
		event as {
			message?: { usage?: { input?: number; cacheRead?: number; cacheWrite?: number } };
		}
	).message?.usage;
	if (!usage) return undefined;
	const total = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
	return total > 0 ? total : undefined;
}

export interface BudgetClock {
	now(): number;
	schedule(fn: () => void, ms: number): () => void;
}

export const systemClock: BudgetClock = {
	now: () => Date.now(),
	schedule: (fn, ms) => {
		const timer = setTimeout(fn, ms);
		return () => clearTimeout(timer);
	},
};

export interface BudgetStop {
	spent(): boolean;
	note(): string | null;
	fired(): boolean;
	/** Resolves the moment a guard trips. Never rejects, never resolves twice. */
	whenFired(): Promise<void>;
	/** Called once, `windDownSec` before the wall-clock timeout, so the run can report instead of being cut mid-stride. */
	windDown(cb: (secsLeft: number) => void): void;
	dispose(): void;
}
