/**
 * pi-subagents: the scrollable transcript screen.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { TranscriptEntry } from "../../../telemetry/live/index.ts";
import { createLineCache, entryLineStart, gutterWidth } from "./screen/index.ts";
import { paintSession } from "./screen/index.ts";
import { createLiveTail } from "./session-live.ts";
import { createStreamRow } from "./screen/index.ts";
import { createTabState, TAB_KEYS } from "./session-tabs.ts";
import { createFind } from "./session-find.ts";
import { createTranscriptCursor } from "./transcript-cursor.ts";

const MIN_BODY = 4;
const CHROME = 4;
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
		lineOf: (index) => entryLineStart(cache, entries, index, widthNow(), gutter),
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

	const find = createFind();

	const linesNow = (width: number): string[] => build(width).concat(stream.linesAt(width));

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
			const painted = paintSession({
				width,
				rows: bodyHeight(),
				title: deps.title,
				stats: deps.stats(),
				base: build(width),
				stream: stream.linesAt(width),
				follow,
				top,
				pendingNew,
				empty: deps.empty,
				theme: deps.theme,
				tabs: tabs.bar(),
				note: tabs.note(),
				find: find.view().label,
			});
			top = painted.top;
			return painted.lines;
		},
		handleInput(data: string): void {
			const width = widthNow();
			if (find.editing) {
				if (matchesKey(data, Key.escape)) find.cancel();
				else if (matchesKey(data, Key.enter)) {
					const line = find.commit(linesNow(width));
					if (line !== undefined) return scrollTo(line, width);
				} else if (matchesKey(data, Key.backspace)) find.backspace();
				else if (data.length === 1 && data >= " ") find.type(data);
				deps.render();
				return;
			}
			if (data === "/") {
				find.begin();
				deps.render();
				return;
			}
			if (data === "n" || data === "N") {
				const line = find.step(data === "n" ? 1 : -1, linesNow(width));
				if (line !== undefined) return scrollTo(line, width);
				deps.render();
				return;
			}
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
