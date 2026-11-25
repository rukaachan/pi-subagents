/**
 * pi-subagents: a run's messages as short, displayable entries.
 */

import { describeToolCall } from "./activity.ts";

export type TranscriptKind = "you" | "agent" | "tool" | "result" | "error";

export interface TranscriptEntry {
	kind: TranscriptKind;
	label: string;
	text: string;
}

export interface TranscriptOptions {
	/** Viewer mode: keep newlines and much longer bodies. */
	full?: boolean;
	/** Most entries kept after shaping. Default 400. */
	maxEntries?: number;
	/** Most text kept after shaping, in chars. Default unlimited. */
	textBudget?: number;
	/** Tool/error chars kept in full mode. Default 8000. */
	resultChars?: number;
}

const COMPACT = { user: 600, text: 1200, result: 800 } as const;
const FULL = { user: 2000, text: 8000, result: 8000 } as const;
export const MAX_ENTRIES = 400;
const STREAM_CHARS = 4000;

function flat(text: string, max: number): string {
	const one = text.replace(/\s+/g, " ").trim();
	return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

function clip(text: string, max: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 1)}…`;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function textBlocks(content: unknown): string[] {
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];
	const out: string[] = [];
	for (const block of content) {
		const b = record(block);
		if (b?.type === "text" && typeof b.text === "string") out.push(b.text);
	}
	return out;
}

function joinText(content: unknown): string {
	return textBlocks(content)
		.map((part) => part.trim())
		.filter(Boolean)
		.join("\n");
}

function capped(text: string, max: number, full: boolean): string {
	return full ? clip(text, max) : flat(text, max);
}

function assistantEntries(
	message: Record<string, unknown>,
	out: TranscriptEntry[],
	opts: TranscriptOptions,
): void {
	const caps = opts.full ? FULL : COMPACT;
	const resultCap = opts.resultChars ?? caps.result;
	if (Array.isArray(message.content)) {
		for (const block of message.content) {
			const b = record(block);
			if (!b) continue;
			if (b.type === "text" && typeof b.text === "string") {
				const text = capped(b.text, caps.text, opts.full === true);
				if (text) out.push({ kind: "agent", label: "agent", text });
			}
			if (b.type === "toolCall" && typeof b.name === "string") {
				const detail = describeToolCall(b.name, b.arguments);
				out.push({
					kind: "tool",
					label: `→ ${b.name}`,
					text: detail ? capped(detail, caps.text, opts.full === true) : "",
				});
			}
		}
	}
	if (
		message.stopReason === "error" &&
		typeof message.errorMessage === "string" &&
		message.errorMessage
	) {
		out.push({
			kind: "error",
			label: "error",
			text: capped(message.errorMessage, resultCap, opts.full === true),
		});
	}
}

function entriesFor(message: unknown, out: TranscriptEntry[], opts: TranscriptOptions): void {
	const caps = opts.full ? FULL : COMPACT;
	const resultCap = opts.resultChars ?? caps.result;
	const m = record(message);
	if (!m) return;
	switch (m.role) {
		case "user": {
			const text = capped(joinText(m.content), caps.user, opts.full === true);
			if (text) out.push({ kind: "you", label: "you", text });
			return;
		}
		case "assistant":
			assistantEntries(m, out, opts);
			return;
		case "toolResult": {
			const name = typeof m.toolName === "string" ? m.toolName : "tool";
			const text = capped(joinText(m.content), resultCap, opts.full === true);
			out.push({
				kind: m.isError === true ? "error" : "result",
				label: `← ${name}`,
				text,
			});
			return;
		}
		default:
			return;
	}
}

/** Shape messages with no cap and no head row. */
export function shapeMessages(
	messages: readonly unknown[],
	opts: TranscriptOptions = {},
): TranscriptEntry[] {
	const out: TranscriptEntry[] = [];
	for (const message of messages) entriesFor(message, out, opts);
	return out;
}

function trim(
	entries: TranscriptEntry[],
	opts: TranscriptOptions,
): { kept: TranscriptEntry[]; hidden: number } {
	const maxEntries = Math.max(1, opts.maxEntries ?? MAX_ENTRIES);
	let start = Math.max(0, entries.length - maxEntries);
	const budget = opts.textBudget ?? 0;
	if (budget > 0) {
		let total = 0;
		for (let i = start; i < entries.length; i += 1) total += entries[i]?.text.length ?? 0;
		while (start < entries.length - 1 && total > budget) {
			total -= entries[start]?.text.length ?? 0;
			start += 1;
		}
	}
	return { kept: entries.slice(start), hidden: start };
}

export function transcriptEntries(
	messages: readonly unknown[],
	opts: TranscriptOptions = {},
): TranscriptEntry[] {
	const { kept, hidden } = trim(shapeMessages(messages, opts), opts);
	if (hidden === 0) return kept;
	return [{ kind: "result", label: "…", text: `${hidden} earlier entries hidden` }, ...kept];
}

/** The in-flight assistant text, tail-clipped for a live preview. */
export function streamText(message: unknown, max = STREAM_CHARS): string {
	const m = record(message);
	if (!m || m.role !== "assistant") return "";
	const text = joinText(m.content);
	if (text.length <= max) return text;
	return `…${text.slice(-max)}`;
}
