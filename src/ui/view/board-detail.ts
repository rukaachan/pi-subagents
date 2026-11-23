/**
 * pi-subagents: the selected-run pane beside the board list.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { BoardRow } from "./board-model.ts";

const STATUS_COLOR: Record<BoardRow["section"], "accent" | "success" | "error" | "warning"> = {
	queued: "warning",
	running: "accent",
	done: "success",
	failed: "error",
};

function tokens(n: number): string {
	if (n <= 0) return "";
	if (n < 1000) return `${n}tok`;
	return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}ktok`;
}

export function detailLines(
	row: BoardRow | undefined,
	width: number,
	theme: Pick<Theme, "fg" | "bold">,
): string[] {
	if (!row) return [theme.fg("dim", "No run selected")];
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
	if (row.runId) lines.push(theme.fg("dim", "part of a multi-leg run"));
	lines.push(theme.fg("dim", `id ${row.taskId}`));
	return lines.map((line) => truncateToWidth(line, width, "…"));
}
