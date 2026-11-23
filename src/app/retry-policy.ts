/**
 * pi-subagents: retry delay policy.
 *
 * Pure policy; the caller owns the clock, the RNG, and the stop flag.
 */

export type RetryReason = "jitter" | "header" | "cooldown";

export interface RetryPlan {
	delayMs: number;
	reason: RetryReason;
}

export interface RetryPolicyOptions {
	now?: () => number;
	random?: () => number;
}

const BASE_DELAYS_MS = [1000, 4000] as const;
const MAX_DELAY_MS = 30_000;
const JITTER = 0.25;

function baseDelay(attempt: number): number {
	return BASE_DELAYS_MS[Math.max(0, Math.min(attempt - 1, BASE_DELAYS_MS.length - 1))] ?? 4000;
}

function isRateLimited(error: string): boolean {
	return /\b429\b|rate[ -]?limit|too many requests/i.test(error);
}

/** Seconds or an HTTP date from the first Retry-After line, or undefined. */
export function retryAfterMs(error: string, now: number): number | undefined {
	const line = error.match(/retry-after\s*:\s*([^\r\n]+)/i)?.[1]?.trim();
	if (!line) return undefined;
	const seconds = line.match(/^(\d+(?:\.\d+)?)\s*s?$/i);
	if (seconds) return Math.max(0, Number(seconds[1]) * 1000);
	const date = Date.parse(line);
	return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export class RetryPolicy {
	private readonly now: () => number;
	private readonly random: () => number;
	private readonly cooldowns = new Map<string, number>();

	constructor(opts: RetryPolicyOptions = {}) {
		this.now = opts.now ?? Date.now;
		this.random = opts.random ?? Math.random;
	}

	/** The delay before the next attempt, and why it was chosen. */
	delayFor(attempt: number, error: string, modelKey: string): RetryPlan {
		const now = this.now();
		const base = baseDelay(attempt);
		const jittered = Math.round(base * (1 - JITTER + this.random() * JITTER * 2));
		const header = retryAfterMs(error, now);
		const remaining = Math.max(0, (this.cooldowns.get(modelKey) ?? 0) - now);
		const reason: RetryReason =
			header !== undefined ? "header" : remaining > 0 ? "cooldown" : "jitter";
		const delayMs = Math.min(MAX_DELAY_MS, Math.max(jittered, header ?? 0, remaining));
		if (isRateLimited(error)) this.cooldowns.set(modelKey, now + delayMs);
		return { delayMs, reason };
	}

	clear(): void {
		this.cooldowns.clear();
	}
}

/**
 * Wait in short slices so a stop does not wait out a 30 s retry.
 * Returns false when stopped; true when the full wait elapsed.
 */
export async function sleepUnlessStopped(
	ms: number,
	stopped: () => boolean,
	sliceMs = 100,
): Promise<boolean> {
	const end = Date.now() + Math.max(0, ms);
	while (Date.now() < end) {
		if (stopped()) return false;
		const left = end - Date.now();
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, Math.min(sliceMs, left));
			timer.unref?.();
		});
	}
	return !stopped();
}
