/**
 * pi-subagents: folding journal lines into per-run state.
 */
import { readFileSync, statSync } from "node:fs";
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

/** A journal file with its identity at one instant. */
interface JournalFile {
	path: string;
	/** Nanosecond mtime and byte size, so a rewrite can never look unchanged. */
	key: string;
}

interface FoldCache {
	key: string;
	runs: JournalRun[];
}

const foldCache = new Map<string, FoldCache>();
const idCache = new Map<string, FoldCache>();
const CACHE_LIMIT = 4;

/** A cached run must never be mutated by a caller, so every return is a copy. */
function cloneRun(run: JournalRun): JournalRun {
	return {
		...run,
		...(run.recent ? { recent: run.recent.map((step) => ({ ...step })) } : {}),
	};
}

function remember(
	cache: Map<string, FoldCache>,
	path: string,
	key: string,
	runs: JournalRun[],
): void {
	cache.delete(path);
	cache.set(path, { key, runs });
	if (cache.size > CACHE_LIMIT) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
}

/** The live file, or the rotated one when the live file is missing. */
function journalFile(path: string): JournalFile | null {
	for (const candidate of [path, `${path}.1`]) {
		try {
			const stat = statSync(candidate, { bigint: true });
			return { path: candidate, key: `${stat.mtimeNs}:${stat.size}` };
		} catch {
			/* try the rotated file */
		}
	}
	return null;
}

function linesOf(path: string, maxLines: number): string[] {
	try {
		return readFileSync(path, "utf8").split("\n").slice(-maxLines);
	} catch {
		return [];
	}
}

export function foldJournalFile(path = defaultJournalPath(), maxLines = 20_000): JournalRun[] {
	const file = journalFile(path);
	if (!file) return [];
	const cached = foldCache.get(file.path);
	if (cached && cached.key === file.key) return cached.runs.map(cloneRun);
	const runs = foldJournal(linesOf(file.path, maxLines));
	remember(foldCache, file.path, file.key, runs);
	return runs;
}

/**
 * One run's folded state by id, newest file first. Never throws.
 *
 * Only the lines that mention the id are parsed, so one lookup costs a scan
 * of the file instead of a JSON parse of every event in it. Repeat lookups
 * against an unchanged file are served from a one-entry memo.
 */
export function findJournalRun(id: string, path = defaultJournalPath()): JournalRun | undefined {
	const file = journalFile(path);
	if (!file) return undefined;
	const cached = idCache.get(file.path);
	if (cached && cached.key === file.key) {
		const hit = cached.runs.find((run) => run.id === id);
		if (hit) return cloneRun(hit);
	}
	let text: string;
	try {
		text = readFileSync(file.path, "utf8");
	} catch {
		return undefined;
	}
	const needle = `"${id}"`;
	const mine: string[] = [];
	let from = 0;
	for (;;) {
		const hit = text.indexOf(needle, from);
		if (hit < 0) break;
		const start = text.lastIndexOf("\n", hit) + 1;
		const end = text.indexOf("\n", hit);
		mine.push(text.slice(start, end < 0 ? text.length : end));
		from = end < 0 ? text.length : end + 1;
	}
	if (mine.length === 0) {
		remember(idCache, file.path, file.key, []);
		return undefined;
	}
	const runs = foldJournal(mine);
	remember(idCache, file.path, file.key, runs);
	const found = runs.findLast((run) => run.id === id);
	return found ? cloneRun(found) : undefined;
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
