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
}

function keyHint(width: number): string {
	if (width >= 100)
		return "1/2/3 tabs · e error · y copy · ↑↓ scroll · PgUp/PgDn · g/G · f follow · ^O expand · esc back";
	if (width >= 72) return "1/2/3 · e error · y copy · ↑↓ · g/G · f · ^O · esc back";
	if (width >= 50) return "1/2/3 · e · y · ↑↓ · esc back";
	return "1/2/3 · esc back";
}

export function frameLines(opts: FrameOptions): string[] {
	const { width, rows, total, top, theme } = opts;
	const rule = theme.fg("borderMuted", "─".repeat(Math.max(1, width)));
	const head = `${theme.bold(opts.title)}  ${theme.fg("muted", opts.stats)}`;
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
