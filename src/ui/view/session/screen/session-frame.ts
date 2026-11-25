/**
 * pi-subagents: the fixed frame around the transcript rows.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export interface FrameOptions {
	width: number;
	rows: number;
	title: string;
	stats: string;
	total: number;
	top: number;
	shown: string[];
	empty: string;
	fresh: string;
	theme: Pick<Theme, "fg" | "bold">;
	tabs?: string;
	note?: string;
	/** Search counter, input, or miss notice. */
	find?: string;
}

function keyHint(width: number): string {
	if (width >= 100)
		return "1/2/3 tabs · e error · y copy · / find · n/N · ↑↓ · g/G · f follow · ^O · esc back";
	if (width >= 72) return "1/2/3 · e error · y copy · / find · n/N · ↑↓ · g/G · f · esc back";
	if (width >= 50) return "1/2/3 · e · y · / find · ↑↓ · esc back";
	return "1/2/3 · / find · esc back";
}

export function frameLines(opts: FrameOptions): string[] {
	const { width, rows, total, top, theme } = opts;
	const rule = theme.fg("borderMuted", "─".repeat(Math.max(1, width)));
	const found = opts.find ? `  ${theme.fg("accent", opts.find)}` : "";
	const head = `${theme.bold(opts.title)}  ${theme.fg("muted", opts.stats)}${found}`;
	const bar = truncateToWidth(
		opts.tabs ?? theme.fg("borderMuted", "─── transcript ───"),
		width,
		"…",
	);
	const shown = total === 0 ? [theme.fg("muted", `  ${opts.empty}`)] : opts.shown;
	const body = [...shown, ...Array.from({ length: Math.max(0, rows - shown.length) }, () => "")];
	const at = total === 0 ? "0/0" : `${top + 1}–${Math.min(total, top + rows)}/${total}`;
	const hint = theme.fg(
		"dim",
		`${keyHint(width)} · ${at}${opts.fresh}${opts.note ? ` · ${opts.note}` : ""}`,
	);
	return [
		rule,
		truncateToWidth(head, width, "…"),
		bar,
		...body.map((line) => truncateToWidth(line, width, "")),
		rule,
		truncateToWidth(hint, width, "…"),
	];
}
