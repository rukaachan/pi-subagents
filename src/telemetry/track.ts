/**
 * pi-subagents: tracking one child run.
 */

import { describeToolCall } from "./activity.ts";
import { compactionNote, nestedStep } from "../domain/activity-step.ts";
import { journalWrite } from "./journal.ts";
import { cut, footerProgress } from "./progress.ts";

export interface TrackableSession {
	subscribe(
		listener: (event: {
			type: string;
			toolName?: string;
			args?: unknown;
			toolCallId?: string;
			parentToolCallId?: string;
			message?: { role?: string; content?: unknown };
			reason?: string;
			result?: { tokensBefore?: number; estimatedTokensAfter?: number };
			aborted?: boolean;
			errorMessage?: string;
		}) => void,
	): () => void;
}

/** Pull plain text out of one assistant message. Pure, never throws. */

export function messageText(message?: { role?: string; content?: unknown }): string {
	try {
		if (!message || message.role !== "assistant") return "";
		const parts = Array.isArray(message.content) ? message.content : [];
		const text = parts
			.map((p) => {
				const block = p as { type?: string; text?: string };
				return block?.type === "text" && typeof block.text === "string" ? block.text : "";
			})
			.join(" ");
		return cut(text, 120);
	} catch {
		return "";
	}
}

export function shortKey(key: string): string {
	return key.replace(/[^a-z0-9]/gi, "").slice(-4) || key;
}

let runSeq = 0;

export function newRunKey(): string {
	runSeq += 1;
	return `run-${runSeq}`;
}

export function trackSession(
	session: TrackableSession,
	key: string,
	label: string,
	opts?: { journalId?: string; kind?: string },
): (final?: RunEndInfo) => void {
	footerProgress.start(key, label);
	const journalId = opts?.journalId;
	const startedAt = Date.now();
	let turns = 0;
	let ended = false;
	// Silences between ANY two session events, kept per run so the stall floor can be re-measured later.
	let lastEventAt = startedAt;
	let gapMaxMs = 0;
	let gapOver60 = 0;
	if (journalId) {
		journalWrite({
			event: "run_start",
			id: journalId,
			label,
			kind: opts?.kind ?? "run",
		});
	}
	// The tool the model called, and its id.
	let outerTool = "";
	let outerCallId = "";
	let unsub: (() => void) | null = null;
	try {
		unsub = session.subscribe((event) => {
			try {
				const now = Date.now();
				const gap = now - lastEventAt;
				if (gap > gapMaxMs) gapMaxMs = gap;
				if (gap >= 60_000) gapOver60 += 1;
				lastEventAt = now;
				if (event.type === "turn_start") {
					footerProgress.turn(key);
				} else if (event.type === "turn_end") {
					turns += 1;
					if (journalId) journalWrite({ event: "turn", id: journalId, turns });
				} else if (event.type === "tool_execution_start" && event.toolName) {
					const detail = describeToolCall(event.toolName, event.args);
					const nested = event.parentToolCallId !== undefined;
					if (!nested) {
						outerTool = event.toolName;
						outerCallId = event.toolCallId ?? "";
					}
					// The parent is the call that runs the script. When we
					// know that call, the step names it; otherwise it stays
					// a plain "script", never a guess.
					const scriptTool =
						nested && event.parentToolCallId === outerCallId ? outerTool : "script";
					const step = nested
						? nestedStep(scriptTool, event.toolName, detail)
						: { tool: event.toolName, ...(detail ? { detail } : {}) };
					footerProgress.step(key, step);
					if (journalId)
						journalWrite({
							event: "tool",
							id: journalId,
							tool: step.tool,
							turns,
							...(step.detail ? { detail: step.detail } : {}),
							...(nested ? { nested: event.toolName } : {}),
						});
				} else if (event.type === "compaction_end") {
					const before = event.result?.tokensBefore ?? 0;
					const note = compactionNote(before, event.result?.estimatedTokensAfter);
					footerProgress.note(key, note);
					if (journalId)
						journalWrite({
							event: "compact",
							id: journalId,
							turns,
							reason: event.reason ?? "threshold",
							tokensBefore: before,
							...(event.result?.estimatedTokensAfter !== undefined
								? { tokensAfter: event.result.estimatedTokensAfter }
								: {}),
							...(event.aborted ? { aborted: true } : {}),
						});
				} else if (event.type === "message_end") {
					const text = messageText(event.message);
					if (text) footerProgress.note(key, text);
				}
			} catch {}
		});
	} catch {}
	return (final?: RunEndInfo) => {
		try {
			unsub?.();
		} catch {}
		footerProgress.finish(key);
		if (journalId && !ended) {
			ended = true;
			journalWrite({
				event: "run_end",
				id: journalId,
				status: final?.status ?? "done",
				turns,
				elapsedSec: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
				...(final?.reportChars !== undefined ? { reportChars: final.reportChars } : {}),
				...(final?.model ? { model: final.model } : {}),
				...(final?.error ? { error: final.error } : {}),
				...(final?.notes && final.notes.length > 0 ? { notes: final.notes } : {}),
				gapMaxSec: Math.round(gapMaxMs / 1000),
				gapOver60,
			});
		}
	};
}

export interface RunEndInfo {
	/** `interrupted`: a stop request (Esc, reload, quit) killed the run. */
	status: "done" | "error" | "interrupted";
	reportChars?: number;
	model?: string;
	error?: string;
	notes?: string[];
}
