/**
 * pi-subagents: the fixed frame around the transcript rows.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { fitHint, screenHeader } from "../../design/index.ts";

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
		return "1/2/3 tabs   e error   y copy   / find   n/N   ↑↓   g/G   f follow   ^O   esc back";
	if (width >= 72) return "1/2/3   e error   y copy   / find   n/N   ↑↓   g/G   f   esc back";
	if (width >= 50) return "1/2/3   e   y   / find   ↑↓   esc back";
	return "1/2/3   / find   esc back";
}

export function frameLines(opts: FrameOptions): string[] {
	const { width, rows, total, top, theme } = opts;
	const found = opts.find ? ` · ${opts.find}` : "";
	const head = screenHeader(opts.title, `${opts.stats}${found}`, width, theme);
	const bar = truncateToWidth(opts.tabs ?? theme.fg("muted", "1 transcript"), width, "…");
	const shown = total === 0 ? [theme.fg("muted", `  ${opts.empty}`)] : opts.shown;
	const body = [...shown, ...Array.from({ length: Math.max(0, rows - shown.length) }, () => "")];
	const at = total === 0 ? "0/0" : `${top + 1}–${Math.min(total, top + rows)}/${total}`;
	const hint = fitHint(
		`${keyHint(width)}   ${at}${opts.fresh}${opts.note ? ` · ${opts.note}` : ""}`,
		width,
		theme,
	);
	return [head, bar, "", ...body.map((line) => truncateToWidth(line, width, "")), hint];
}
