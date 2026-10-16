/**
 * pi-subagents: what a stopped run says.
 */
import { HARD_STOP_GRACE_MS } from "./wind.ts";

export function annotateFailure(err: unknown, note: string | null): unknown {
	if (!note) return err;
	const base = err instanceof Error ? err.message : String(err);
	return new Error(`${base} (${note})`);
}

export async function awaitWithHardStop(
	session: { dispose(): void },
	run: Promise<unknown>,
	stop: { whenFired(): Promise<void> },
	graceMs: number = HARD_STOP_GRACE_MS,
): Promise<"settled" | "abandoned"> {
	// Keep the detached promise handled: a rejection that lands after the
	// race was decided must not become an unhandled rejection (fatal by
	// default in Node).
	void run.catch(() => undefined);
	const settled = run.then(() => "settled" as const);
	let graceTimer: ReturnType<typeof setTimeout> | undefined;
	// The grace starts when the guard fires, not when the await starts.
	// Arming it up front made a 5,400s run abandon instantly: the timer
	// had long since expired, so the fired branch resolved with no wait.
	const abandoned = stop.whenFired().then(
		() =>
			new Promise<"abandoned">((resolve) => {
				graceTimer = setTimeout(() => resolve("abandoned"), graceMs);
			}),
	);
	try {
		const outcome = await Promise.race([settled, abandoned]);
		if (outcome === "abandoned") session.dispose();
		return outcome;
	} finally {
		clearTimeout(graceTimer);
	}
}

export function surfaceBudgetNotes(
	notes: string[],
	stop: { spent(): boolean; note(): string | null },
): string | null {
	const note = stop.note();
	if (!note) return null;
	notes.push(note);
	return stop.spent() ? note : null;
}
