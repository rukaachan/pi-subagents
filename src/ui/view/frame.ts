/**
 * pi-subagents: shared header and status-bar chrome.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** The hint row in its own box; the top edge joins the pane divider. */
export function hintFrame(
	hint: string,
	width: number,
	divider: number | undefined,
	theme: Pick<Theme, "fg">,
): string[] {
	const inner = Math.max(1, width - 4);
	const clipped = truncateToWidth(hint, inner, "…");
	const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
	const cells = Array.from({ length: Math.max(0, width - 2) }, () => "─");
	if (divider !== undefined && divider > 0 && divider < width - 1) cells[divider - 1] = "┴";
	return [
		theme.fg("borderMuted", `┌${cells.join("")}┐`),
		theme.fg("borderMuted", "│ ") + clipped + pad + theme.fg("borderMuted", " │"),
		theme.fg("borderMuted", `└${"─".repeat(Math.max(0, width - 2))}┘`),
	];
}
