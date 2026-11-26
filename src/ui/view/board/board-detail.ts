/**
 * pi-subagents: the selected-run pane beside the board list.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { BoardRow } from "./board-model.ts";
import { actionKeys } from "./board-hint.ts";

const STATUS_COLOR: Record<
	BoardRow["section"],
	"accent" | "success" | "error" | "warning" | "dim"
> = {
	queued: "warning",
	running: "accent",
	done: "success",
	stopped: "dim",
	failed: "error",
};

const STEP_LIMIT = 3;

function tokens(n: number): string {
	if (n <= 0) return "";
	if (n < 1000) return `${n}tok`;
	return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}ktok`;
}

export interface DetailPane {
	steps?: readonly string[];
	/** Body rows available; the action keys sit on the last one. */
	height?: number;
}

export function detailLines(
	row: BoardRow | undefined,
	width: number,
	theme: Pick<Theme, "fg" | "bold">,
	pane: DetailPane = {},
): string[] {
	if (!row) {
		return [
			theme.fg("muted", "No runs yet."),
			theme.fg("dim", "Press enter to run something."),
			theme.fg("dim", "Or /subagents new to create a subagent."),
		];
	}
	const state = row.section === "queued" ? "QUEUED" : row.section.toUpperCase();
	const metrics = [
		row.section === "queued" ? "waiting for a slot" : `${row.turns}t · ${row.elapsedSec}s`,
		row.section === "queued" ? "" : tokens(row.tokens),
		row.cost ? `$${row.cost.toFixed(3)}` : "",
	].filter(Boolean);
	const lines = [
		theme.fg("muted", "SELECTED"),
		theme.bold(row.name),
		theme.fg("dim", row.label),
		theme.fg(STATUS_COLOR[row.section], state),
		theme.fg("dim", metrics.join(" · ")),
	];
	if (row.failure) lines.push(theme.fg("error", `!${row.failure}`));
	const steps = (pane.steps ?? []).slice(-STEP_LIMIT);
	if (steps.length > 0) {
		lines.push("", theme.fg("muted", "now"));
		for (const step of steps) lines.push(theme.fg("dim", step));
	} else if (row.section === "running") {
		lines.push("", theme.fg("warning", "waiting for the first step"));
	} else if (row.section === "queued") {
		lines.push("", theme.fg("warning", "waiting for a slot"));
	}
	lines.push("");
	if (row.runId) lines.push(theme.fg("dim", "part of a multi-leg run"));
	lines.push(theme.fg("dim", `id ${row.taskId}`));
	const keys = actionKeys(row);
	if (pane.height !== undefined && keys.length > 0 && lines.length < pane.height) {
		while (lines.length < pane.height - 1) lines.push("");
		lines.push(theme.fg("dim", keys.join(" · ")));
	}
	return lines.map((line) => truncateToWidth(line, width, "…"));
}
