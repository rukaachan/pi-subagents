/**
 * pi-subagents: incremental message-to-entry shaping for the viewer.
 */

import { shapeMessages, type TranscriptEntry } from "../../telemetry/transcript.ts";

const MAX_ENTRIES = 400;
const BODY_CHARS = 300_000;
const VIEWER = { full: true, resultChars: 40_000 } as const;

export interface TranscriptCursor {
	entries: () => readonly TranscriptEntry[];
	pull: (messages: readonly unknown[]) => void;
}

function textLength(content: unknown): number {
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	let n = 0;
	for (const block of content) {
		if (block && typeof block === "object") {
			const b = block as Record<string, unknown>;
			if (typeof b.text === "string") n += b.text.length;
		}
	}
	return n;
}

/** Cheap change signal: count, last role, and last text size. */
export function fingerprint(messages: readonly unknown[]): string {
	const last = messages.at(-1) as Record<string, unknown> | undefined;
	return `${messages.length}:${String(last?.role ?? "")}:${textLength(last?.content)}`;
}

export function createTranscriptCursor(
	maxEntries = MAX_ENTRIES,
	textBudget = BODY_CHARS,
): TranscriptCursor {
	let committed: TranscriptEntry[] = [];
	let tail: TranscriptEntry[] = [];
	let visible: TranscriptEntry[] = [];
	let cursor = 0;
	let boundary: unknown;
	let hidden = 0;
	let committedChars = 0;

	function trim(): void {
		let tailChars = 0;
		for (const entry of tail) tailChars += entry.text.length;
		while (
			committed.length > 0 &&
			(committed.length + tail.length > maxEntries || committedChars + tailChars > textBudget)
		) {
			const first = committed.shift();
			if (!first) break;
			committedChars -= first.text.length;
			hidden += 1;
		}
	}

	function rebuild(): void {
		const head: TranscriptEntry[] =
			hidden > 0 ? [{ kind: "result", label: "…", text: `${hidden} earlier entries hidden` }] : [];
		visible = [...head, ...committed, ...tail];
	}

	function pull(messages: readonly unknown[]): void {
		if (messages.length < cursor || (cursor > 0 && messages[cursor - 1] !== boundary)) {
			committed = [];
			cursor = 0;
			boundary = undefined;
			hidden = 0;
			committedChars = 0;
		}
		if (messages.length === 0) {
			tail = [];
			rebuild();
			return;
		}
		const end = messages.length - 1;
		if (end > cursor) {
			const added = shapeMessages(messages.slice(cursor, end), VIEWER);
			committed.push(...added);
			for (const entry of added) committedChars += entry.text.length;
			cursor = end;
			boundary = messages[end - 1];
		}
		tail = shapeMessages(messages.slice(cursor), VIEWER);
		trim();
		rebuild();
	}

	return { entries: () => visible, pull };
}
