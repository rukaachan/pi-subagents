/**
 * pi-subagents: the live streaming row, coalesced to 30 fps.
 */

import { streamText, type TranscriptEntry } from "../../../../telemetry/live/index.ts";
import type { LineCache } from "./line-cache.ts";

const STREAM_MS = 33;

export interface StreamRowDeps {
	streaming: () => unknown;
	cache: LineCache;
	gutter: () => number;
	width: () => number;
	render: () => void;
	closed: () => boolean;
}

export interface StreamRow {
	linesAt: (width: number) => string[];
	schedule: () => void;
	flush: () => void;
	clear: () => void;
}

export function createStreamRow(deps: StreamRowDeps): StreamRow {
	let entry: TranscriptEntry | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;

	function shape(): TranscriptEntry | undefined {
		const message = deps.streaming();
		if (!message) return undefined;
		const text = streamText(message);
		return text ? { kind: "agent", label: "agent", text: `${text}▍` } : undefined;
	}

	function rowsFor(next: TranscriptEntry | undefined, width: number): string[] {
		return next ? deps.cache.linesFor(next, width, deps.gutter()) : [];
	}

	function flush(): void {
		if (deps.closed()) return;
		const next = shape();
		const changed = next?.text !== entry?.text;
		entry = next;
		if (changed) deps.render();
	}

	function schedule(): void {
		if (deps.closed() || timer !== undefined) return;
		timer = setTimeout(() => {
			timer = undefined;
			try {
				flush();
			} catch {
				/* the viewer never breaks a run */
			}
		}, STREAM_MS);
	}

	function clear(): void {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		entry = undefined;
	}

	return {
		linesAt: (width) => rowsFor(entry, width),
		schedule,
		flush,
		clear,
	};
}
