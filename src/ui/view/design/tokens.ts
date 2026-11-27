/**
 * pi-subagents: the one visual system shared by every screen.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";

export type UiTheme = Pick<Theme, "fg" | "bold">;

export type Tone =
	| "accent"
	| "success"
	| "warning"
	| "error"
	| "dim"
	| "muted"
	| "text"
	| "borderMuted";

export interface StatusStyle {
	glyph: string;
	tone: Tone;
	label: string;
}

export const STATUS: Record<string, StatusStyle> = {
	queued: { glyph: "○", tone: "warning", label: "queued" },
	running: { glyph: "●", tone: "accent", label: "running" },
	done: { glyph: "✓", tone: "success", label: "done" },
	stopped: { glyph: "⊘", tone: "dim", label: "stopped" },
	failed: { glyph: "✗", tone: "error", label: "failed" },
	pending: { glyph: "○", tone: "warning", label: "open" },
	in_progress: { glyph: "●", tone: "accent", label: "in progress" },
	in_review: { glyph: "?", tone: "warning", label: "in review" },
	completed: { glyph: "✓", tone: "success", label: "done" },
	deleted: { glyph: "·", tone: "dim", label: "deleted" },
};

export function statusStyle(status: string | undefined): StatusStyle {
	return (status && STATUS[status]) || { glyph: "·", tone: "muted", label: "" };
}

export function paint(theme: UiTheme, tone: Tone, text: string): string {
	return theme.fg(tone, text);
}

export function duration(sec: number): string {
	const total = Math.max(0, Math.round(sec));
	if (total < 60) return total + "s";
	const minutes = Math.floor(total / 60);
	if (minutes < 60) return minutes + ":" + String(total % 60).padStart(2, "0");
	return (
		Math.floor(minutes / 60) +
		":" +
		String(minutes % 60).padStart(2, "0") +
		":" +
		String(total % 60).padStart(2, "0")
	);
}

export function tokenCount(n: number): string {
	if (n <= 0) return "";
	if (n < 1000) return n + " tok";
	if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k tok";
	return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M tok";
}
