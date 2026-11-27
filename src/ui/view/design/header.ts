/**
 * pi-subagents: the screen header, tab bar, and section labels.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { paint, type UiTheme } from "./tokens.ts";

export function screenHeader(
	title: string,
	summary: string,
	width: number,
	theme: UiTheme,
): string {
	const room = Math.max(1, width - 2);
	const left = paint(theme, "text", theme.bold(title));
	if (!summary) return truncateToWidth(" " + left, width, "…");
	const summaryRoom = Math.max(0, room - visibleWidth(title) - 1);
	const right = truncateToWidth(summary, summaryRoom, "…");
	const gap = Math.max(1, room - visibleWidth(title) - visibleWidth(right));
	return truncateToWidth(" " + left + " ".repeat(gap) + paint(theme, "dim", right), width, "…");
}

export function tabsLine(
	labels: readonly string[],
	active: number,
	width: number,
	theme: UiTheme,
): string {
	const text = labels
		.map((label, index) =>
			index === active ? paint(theme, "accent", theme.bold(label)) : paint(theme, "dim", label),
		)
		.join("   ");
	return truncateToWidth(" " + text, width, "…");
}

export function sectionLine(label: string, count: number, theme: UiTheme): string {
	const tail = count > 0 ? paint(theme, "dim", " · " + count) : "";
	return " " + paint(theme, "muted", label) + tail;
}
