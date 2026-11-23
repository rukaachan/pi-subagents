/**
 * pi-subagents: the scrollable transcript screen.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { TranscriptEntry } from "../../telemetry/transcript.ts";
import { createLineCache, gutterWidth } from "./line-cache.ts";
import { frameLines } from "./session-frame.ts";
import { createLiveTail } from "./session-live.ts";
import { createStreamRow } from "./stream-row.ts";
import { createTabState, TAB_KEYS } from "./session-tabs.ts";
import { createTranscriptCursor } from "./transcript-cursor.ts";

const MIN_BODY = 4;
const CHROME = 5;
const MIN_GUTTER = 6;
const MIN_WIDTH = 20;

// The bits of Pi's TUI this screen uses, so tests can stand in.
export interface SessionViewDeps {
	title: string;
	stats: () => string;
	source: () => readonly unknown[];
	height: () => number;
	theme: Pick<Theme, "fg" | "bold">;
	empty: string;
	render: () => void;
	onClose: () => void;
	poll?: boolean;
	alive?: () => boolean;
	streaming?: () => unknown;
	subscribe?: (fn: (type: string) => void) => () => void;
	onCopy?: (text: string) => void;
}

export interface SessionView {
	render: (width: number) => string[];
	handleInput: (data: string) => void;
	invalidate: () => void;
	dispose: () => void;
	sync: () => void;
}

export function createSessionView(deps: SessionViewDeps): SessionView {
	const cache = createLineCache(deps.theme);
	const cursor = createTranscriptCursor();
	let allEntries: readonly TranscriptEntry[] = cursor.entries();
	let entries: readonly TranscriptEntry[] = [];
	let gutter = 0;
	let version = 0;
	let lines: string[] = [];
	let linesKey = "";
	let lastWidth = 0;
	let top = 0;
	let follow = true;
	let closed = false;
	let pendingNew = 0;

	const bodyHeight = () => Math.max(MIN_BODY, deps.height() - CHROME);
	const streamGutter = () => Math.max(MIN_GUTTER, gutter);
	const widthNow = () => Math.max(MIN_WIDTH, lastWidth || 80);

	function refresh(messages: readonly unknown[]): void {
		cursor.pull(messages);
		allEntries = cursor.entries();
		entries = tabs.entries();
		gutter = gutterWidth(entries);
		version += 1;
	}

	const tabs = createTabState({
		all: () => allEntries,
		theme: deps.theme,
		render: deps.render,
		...(deps.onCopy ? { onCopy: deps.onCopy } : {}),
		reset: () => {
			entries = tabs.entries();
			gutter = gutterWidth(entries);
			version += 1;
			follow = true;
			pendingNew = 0;
		},
		jump: (line) => {
			follow = false;
			scrollTo(line, widthNow());
		},
		lineOf: (index) => lineStart(index, widthNow()),
	});

	refresh(deps.source());

	function build(width: number): string[] {
		const key = `${version}:${width}:${gutter}:${cache.isExpanded()}`;
		if (key === linesKey) return lines;
		const out: string[] = [];
		for (const entry of entries) {
			for (const row of cache.linesFor(entry, width, gutter)) out.push(row);
		}
		lines = out;
		linesKey = key;
		return lines;
	}

	const stream = createStreamRow({
		streaming: deps.streaming ?? (() => undefined),
		cache,
		gutter: streamGutter,
		width: widthNow,
		render: deps.render,
		closed: () => closed,
	});

	const live = createLiveTail({
		source: deps.source,
		stats: deps.stats,
		render: deps.render,
		refresh,
		added: (count) => {
			if (!follow) pendingNew += count;
		},
		stream,
		...(deps.subscribe ? { subscribe: deps.subscribe } : {}),
		...(deps.poll ? { poll: true } : {}),
		...(deps.alive ? { alive: deps.alive } : {}),
		closed: () => closed,
	});

	function stopAll(): void {
		live.dispose();
		tabs.dispose();
		stream.clear();
	}

	function close(): void {
		if (closed) return;
		closed = true;
		stopAll();
		deps.onClose();
	}

	function lineStart(index: number, width: number): number {
		let at = 0;
		for (let i = 0; i < index; i += 1) {
			const entry = entries[i];
			if (entry) at += cache.linesFor(entry, width, gutter).length;
		}
		return at;
	}

	function scrollTo(next: number, width: number): void {
		const limit = Math.max(0, build(width).length + stream.linesAt(width).length - bodyHeight());
		top = Math.max(0, Math.min(next, limit));
		follow = top >= limit;
		if (follow) pendingNew = 0;
		deps.render();
	}

	return {
		render(width: number): string[] {
			lastWidth = width;
			const rows = bodyHeight();
			const base = build(width);
			const streamLines = stream.linesAt(width);
			const total = base.length + streamLines.length;
			if (follow) top = Math.max(0, total - rows);
			else top = Math.max(0, Math.min(top, total - rows));
			const slice = (from: number, to: number): string[] => {
				if (to <= base.length) return base.slice(from, to);
				if (from >= base.length) return streamLines.slice(from - base.length, to - base.length);
				return [...base.slice(from), ...streamLines.slice(0, to - base.length)];
			};
			const fresh = !follow && pendingNew > 0 ? ` · ↓${pendingNew} new` : "";
			return frameLines({
				width,
				rows,
				title: deps.title,
				stats: deps.stats(),
				total,
				top,
				shown: slice(top, top + rows),
				empty: deps.empty,
				fresh,
				theme: deps.theme,
				tabs: tabs.bar(),
				note: tabs.note(),
			});
		},
		handleInput(data: string): void {
			const width = widthNow();
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
				close();
				return;
			}
			const nextTab = TAB_KEYS[data];
			if (nextTab) {
				tabs.select(nextTab);
				return;
			}
			if (data === "e") {
				tabs.error();
				return;
			}
			if (data === "y") {
				tabs.copy();
				return;
			}
			if (matchesKey(data, Key.up) || data === "k") scrollTo(top - 1, width);
			else if (matchesKey(data, Key.down) || data === "j") scrollTo(top + 1, width);
			else if (matchesKey(data, Key.pageUp) || data === "b") scrollTo(top - bodyHeight(), width);
			else if (matchesKey(data, Key.pageDown) || data === " ") scrollTo(top + bodyHeight(), width);
			else if (matchesKey(data, Key.home) || data === "g") scrollTo(0, width);
			else if (matchesKey(data, Key.end) || data === "G") {
				follow = true;
				pendingNew = 0;
			} else if (data === "f") {
				follow = !follow;
				if (follow) pendingNew = 0;
			} else if (matchesKey(data, Key.ctrl("o"))) cache.setExpanded(!cache.isExpanded());
			else return;
			deps.render();
		},
		invalidate(): void {
			cache.reset();
			linesKey = "";
		},
		dispose(): void {
			closed = true;
			stopAll();
		},
		sync(): void {
			live.sync();
		},
	};
}
