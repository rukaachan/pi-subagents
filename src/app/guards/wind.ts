/**
 * pi-subagents: ending a run honestly.
 */

/** Ask for a status this long before the timeout. */
export const WIND_DOWN_SEC = 300;

export function windDownPrompt(secsLeft: number): string {
	return [
		`Time check from the caller: about ${secsLeft} seconds remain before this run is stopped.`,
		"Stop starting new work and do not open new files or tools.",
		"Reply now with a short status: what you finished, what is still unfinished,",
		"and the exact state the caller needs to continue (files touched, commands run, outputs seen).",
	].join(" ");
}

export function windDownNote(secsLeft: number): string {
	return `wrap-up requested with ${secsLeft}s left before the timeout.`;
}

export async function windDownSignal(
	session: { steer(text: string): Promise<unknown> },
	notes: string[],
	secsLeft: number,
): Promise<void> {
	try {
		await session.steer(windDownPrompt(secsLeft));
		notes.push(windDownNote(secsLeft));
	} catch {
		/* steer failed; the timeout still stops the run */
	}
}

/** How long a disposed child gets to settle before it is abandoned. */
export const HARD_STOP_GRACE_MS = 10_000;
