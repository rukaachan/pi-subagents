/**
 * pi-subagents: wrapped, colored transcript rows, cached per entry.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { TranscriptEntry, TranscriptKind } from "../../telemetry/transcript.ts";

export const LABEL_MAX = 14;
export const PREVIEW_LINES = 10;
export const LABEL_MIN = 6;

const KIND_COLOR: Record<TranscriptKind, ThemeColor> = {
	you: "accent",
	agent: "text",
	tool: "toolTitle",
	result: "muted",
	error: "error",
};

export interface LineCache {
	/** Wrapped, colored rows for one entry at this width and gutter. */
	linesFor: (entry: TranscriptEntry, width: number, gutter: number) => string[];
	/** Drop every cached row. */
	reset: () => void;
	/** Pi-style tool output: 10 lines until expanded. */
	setExpanded: (value: boolean) => void;
	isExpanded: () => boolean;
}

export function gutterWidth(entries: readonly TranscriptEntry[]): number {
	let widest = LABEL_MIN;
	for (const entry of entries) widest = Math.max(widest, visibleWidth(entry.label));
	return Math.min(LABEL_MAX, widest);
}

export function createLineCache(theme: Pick<Theme, "fg">): LineCache {
	let cacheWidth = 0;
	let cacheGutter = 0;
	let expanded = false;
	let rows = new WeakMap<TranscriptEntry, string[]>();

	function reset(): void {
		rows = new WeakMap();
	}

	function linesFor(entry: TranscriptEntry, width: number, gutter: number): string[] {
		if (width !== cacheWidth || gutter !== cacheGutter) {
			cacheWidth = width;
			cacheGutter = gutter;
			reset();
		}
		const hit = rows.get(entry);
		if (hit) return hit;
		const color = KIND_COLOR[entry.kind];
		const label = theme.fg(color, entry.label.padEnd(gutter));
		const pad = " ".repeat(gutter);
		const textWidth = Math.max(8, width - gutter - 2);
		const collapsible = entry.kind === "result" || entry.kind === "error";
		// Slice before wrapping, so a 40k result costs one row set when closed.
		const sourceLines = entry.text ? entry.text.split("\n") : [""];
		const hidden = !expanded && collapsible ? Math.max(0, sourceLines.length - PREVIEW_LINES) : 0;
		const shown = hidden > 0 ? sourceLines.slice(0, PREVIEW_LINES) : sourceLines;
		const wrapped = wrapTextWithAnsi(shown.join("\n"), textWidth);
		const out = wrapped.map((part, idx) => `${idx === 0 ? label : pad}  ${theme.fg(color, part)}`);
		if (hidden > 0) {
			out.push(`${pad}  ${theme.fg("muted", `... (${hidden} more lines, ctrl+o to expand)`)}`);
		}
		rows.set(entry, out);
		return out;
	}

	function setExpanded(value: boolean): void {
		if (expanded === value) return;
		expanded = value;
		reset();
	}

	return { linesFor, reset, setExpanded, isExpanded: () => expanded };
}
