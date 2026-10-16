/**
 * pi-subagents: folding journal lines into per-run state.
 */
import { readFileSync } from "node:fs";
import { defaultJournalPath } from "./journal-path.ts";

export interface JournalRun {
	id: string;
	label: string;
	kind: string;
	startedAt: number;
	endedAt?: number;
	elapsedSec?: number;
	/** `interrupted`: a stop request (Esc, reload, quit) ended the run. */
	status: "running" | "done" | "error" | "interrupted";
	turns: number;
	tool?: string;
	reportChars?: number;
	model?: string;
	notes?: string[];
	error?: string;
	compactions?: number;
	gapMaxSec?: number;
	gapOver60?: number;
	recent?: { tool: string; detail?: string }[];
	stale?: boolean;
}

export const STALE_AFTER_MS = 15 * 60 * 1000;

export function foldJournalFile(path = defaultJournalPath(), maxLines = 20_000): JournalRun[] {
	try {
		let text = "";
		try {
			text = readFileSync(path, "utf8");
		} catch {
			text = "";
		}
		if (!text) {
			try {
				text = readFileSync(`${path}.1`, "utf8");
			} catch {
				text = "";
			}
		}
		return foldJournal(text.split("\n").slice(-maxLines));
	} catch {
		return [];
	}
}

/** One run's folded state by id, newest file first. Never throws. */
export function findJournalRun(id: string, path = defaultJournalPath()): JournalRun | undefined {
	const runs = foldJournalFile(path);
	return runs.findLast((r) => r.id === id);
}

export function foldJournal(lines: string[]): JournalRun[] {
	const runs = new Map<string, JournalRun & { lastEventAt?: number }>();
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let ev: Record<string, unknown>;
		try {
			ev = JSON.parse(trimmed) as Record<string, unknown>;
		} catch {
			continue; // torn write mid-flush
		}
		const id = typeof ev.id === "string" ? ev.id : undefined;
		if (!id) continue;
		const ts = typeof ev.ts === "number" ? ev.ts : Date.now();
		switch (ev.event) {
			case "run_start": {
				runs.set(id, {
					id,
					label: String(ev.label ?? "?"),
					kind: String(ev.kind ?? "?"),
					startedAt: ts,
					lastEventAt: ts,
					status: "running",
					turns: 0,
				});
				break;
			}
			case "turn": {
				const run = runs.get(id);
				if (run) {
					run.turns = typeof ev.turns === "number" ? ev.turns : run.turns + 1;
					if (typeof ev.tool === "string") run.tool = ev.tool;
					run.lastEventAt = ts;
				}
				break;
			}
			case "compact": {
				const run = runs.get(id);
				if (run) {
					run.compactions = (run.compactions ?? 0) + 1;
					run.lastEventAt = ts;
				}
				break;
			}
			case "tool": {
				const run = runs.get(id);
				if (run) {
					run.tool = String(ev.tool ?? run.tool);
					if (typeof ev.turns === "number") run.turns = ev.turns;
					const recent = run.recent ?? [];
					recent.push({
						tool: String(ev.tool ?? "?"),
						...(typeof ev.detail === "string" && ev.detail ? { detail: ev.detail } : {}),
					});
					if (recent.length > 3) recent.splice(0, recent.length - 3);
					run.recent = recent;
					run.lastEventAt = ts;
				}
				break;
			}
			case "run_end": {
				const run = runs.get(id);
				if (run) {
					run.status =
						ev.status === "error" ? "error" : ev.status === "interrupted" ? "interrupted" : "done";
					run.endedAt = ts;
					if (typeof ev.elapsedSec === "number") run.elapsedSec = ev.elapsedSec;
					if (typeof ev.turns === "number") run.turns = ev.turns;
					if (typeof ev.reportChars === "number") run.reportChars = ev.reportChars;
					if (typeof ev.model === "string") run.model = ev.model;
					if (Array.isArray(ev.notes)) run.notes = ev.notes.map(String);
					if (typeof ev.error === "string") run.error = ev.error;
					if (typeof ev.gapMaxSec === "number") run.gapMaxSec = ev.gapMaxSec;
					if (typeof ev.gapOver60 === "number") run.gapOver60 = ev.gapOver60;
					run.lastEventAt = ts;
				}
				break;
			}
			default:
				break;
		}
	}
	// Orphan rows: a pi restart kills child sessions before their finally
	// block runs, so no run_end ever lands. Age the row instead, so the
	// table stops reporting dead legs as live work.
	const now = Date.now();
	for (const run of runs.values()) {
		if (run.status === "running" && now - (run.lastEventAt ?? run.startedAt) > STALE_AFTER_MS) {
			run.stale = true;
		}
	}
	return [...runs.values()]
		.map(({ lastEventAt: _drop, ...rest }) => rest)
		.toSorted((a, b) => a.startedAt - b.startedAt);
}
