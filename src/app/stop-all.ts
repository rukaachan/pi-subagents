/**
 * pi-subagents: the one stop request.
 */

import { stopLiveRuns } from "./live-runs.ts";

export const STOPPED_NAMES_SHOWN = 6;

export function stoppedSummary(stopped: string[], why: string): string {
	if (stopped.length === 0) return "";
	const shown = stopped.slice(0, STOPPED_NAMES_SHOWN).join(", ");
	const rest = stopped.length - STOPPED_NAMES_SHOWN;
	const more = rest > 0 ? ` and ${rest} more` : "";
	const noun = stopped.length === 1 ? "subagent" : "subagents";
	return `Stopped ${stopped.length} ${noun} (${why}): ${shown}${more}.`;
}

export function stopAllLiveRuns(why: string): string {
	return stoppedSummary(stopLiveRuns(why), why);
}
