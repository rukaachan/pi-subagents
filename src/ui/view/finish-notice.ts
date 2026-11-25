/**
 * pi-subagents: the /subagents finish start notice.
 */

import type { LaunchLeg } from "../../app/launch.ts";
import type { RosterPick } from "../../domain/subagent/index.ts";

const MAX_ROWS = 8;

export function finishNotice(
	legs: readonly LaunchLeg[],
	started: number,
	queued: number,
	picks: readonly RosterPick[],
	dropped: readonly string[] = [],
): string {
	const why = new Map(picks.map((pick) => [pick.name, pick.why]));
	const rows = legs.slice(0, MAX_ROWS).map((leg, index) => {
		const reason = why.get(leg.name);
		return `${index + 1}. ${leg.name} — ${leg.taskId ?? "queued"}${reason ? ` · ${reason}` : ""}`;
	});
	if (legs.length > MAX_ROWS) rows.push(`… and ${legs.length - MAX_ROWS} more`);
	const state = [`${started} started`, queued > 0 ? `${queued} queued` : ""]
		.filter(Boolean)
		.join(" · ");
	return [
		`finish · ${state}`,
		...rows,
		...(dropped.length > 0 ? [`Over the cap, not started: ${dropped.join(", ")}`] : []),
		"",
		"Legs wake you when they settle; /subagents opens the board.",
	].join("\n");
}
