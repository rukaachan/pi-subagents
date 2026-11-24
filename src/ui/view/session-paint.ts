/**
 * pi-subagents: compose the transcript frame from scroll state.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { frameLines } from "./session-frame.ts";

export interface PaintInput {
	width: number;
	rows: number;
	title: string;
	stats: string;
	base: string[];
	stream: string[];
	/** Follow the tail: pin the view to the newest lines. */
	follow: boolean;
	top: number;
	pendingNew: number;
	empty: string;
	theme: Pick<Theme, "fg" | "bold">;
	tabs?: string;
	note?: string;
	find?: string;
}

export interface PaintResult {
	lines: string[];
	top: number;
}

export function paintSession(input: PaintInput): PaintResult {
	const { width, rows, base, stream } = input;
	const total = base.length + stream.length;
	const top = input.follow
		? Math.max(0, total - rows)
		: Math.max(0, Math.min(input.top, total - rows));
	const slice = (from: number, to: number): string[] => {
		if (to <= base.length) return base.slice(from, to);
		if (from >= base.length) return stream.slice(from - base.length, to - base.length);
		return [...base.slice(from), ...stream.slice(0, to - base.length)];
	};
	const fresh = !input.follow && input.pendingNew > 0 ? ` · ↓${input.pendingNew} new` : "";
	const lines = frameLines({
		width,
		rows,
		title: input.title,
		stats: input.stats,
		total,
		top,
		shown: slice(top, top + rows),
		empty: input.empty,
		fresh,
		theme: input.theme,
		...(input.tabs ? { tabs: input.tabs } : {}),
		...(input.note ? { note: input.note } : {}),
		...(input.find ? { find: input.find } : {}),
	});
	return { lines, top };
}
