#!/usr/bin/env node
/**
 * pi-subagents: watch runs live from a second terminal.
 *
 * Usage:
 *   node tools/watch.mjs              # follow (live table)
 *   node tools/watch.mjs --once       # print current table, exit
 *   node tools/watch.mjs --json       # raw folded rows as JSON
 *   PI_SUBAGENTS_JOURNAL=... node tools/watch.mjs   # custom path
 */

import { readFileSync, watch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const path =
	process.env.PI_SUBAGENTS_JOURNAL ??
	join(homedir(), ".pi", "agent", "pi-subagents-journal.ndjson");
const STALE_AFTER_MS = 15 * 60 * 1000;

const args = process.argv.slice(2);
const once = args.includes("--once");
const asJson = args.includes("--json");

function readLines() {
	try {
		return readFileSync(path, "utf8").split("\n");
	} catch {
		return [];
	}
}

function fold(lines) {
	const runs = new Map();
	for (const line of lines) {
		const t = line.trim();
		if (!t) continue;
		let ev;
		try {
			ev = JSON.parse(t);
		} catch {
			continue;
		}
		const id = typeof ev.id === "string" ? ev.id : undefined;
		if (!id) continue;
		const ts = typeof ev.ts === "number" ? ev.ts : Date.now();
		if (ev.event === "run_start") {
			runs.set(id, {
				id,
				label: String(ev.label ?? "?"),
				kind: String(ev.kind ?? "?"),
				startedAt: ts,
				lastEventAt: ts,
				status: "running",
				turns: 0,
			});
		} else if (ev.event === "turn") {
			const r = runs.get(id);
			if (r) {
				r.turns = typeof ev.turns === "number" ? ev.turns : r.turns + 1;
				r.lastEventAt = ts;
			}
		} else if (ev.event === "compact") {
			const r = runs.get(id);
			if (r) {
				r.compactions = (r.compactions ?? 0) + 1;
				r.lastEventAt = ts;
			}
		} else if (ev.event === "tool") {
			const r = runs.get(id);
			if (r) {
				r.tool = String(ev.tool ?? r.tool);
				r.detail = typeof ev.detail === "string" ? ev.detail : undefined;
				if (typeof ev.turns === "number") r.turns = ev.turns;
				r.lastEventAt = ts;
			}
		} else if (ev.event === "run_end") {
			const r = runs.get(id);
			if (r) {
				r.status =
					ev.status === "error" ? "error" : ev.status === "interrupted" ? "interrupted" : "done";
				r.endedAt = ts;
				r.elapsedSec = typeof ev.elapsedSec === "number" ? ev.elapsedSec : undefined;
				if (typeof ev.turns === "number") r.turns = ev.turns;
				if (typeof ev.reportChars === "number") r.reportChars = ev.reportChars;
				if (typeof ev.model === "string") r.model = ev.model;
				if (typeof ev.error === "string") r.error = ev.error;
				if (Array.isArray(ev.notes)) r.notes = ev.notes.map(String);
				r.lastEventAt = ts;
			}
		}
	}
	// Orphan rows: a pi restart kills child sessions before their finally
	// block runs, so no run_end ever lands. Age the row instead of
	// reporting a dead leg as live work. Same rule as foldJournal.
	const now = Date.now();
	for (const r of runs.values()) {
		if (r.status === "running" && now - (r.lastEventAt ?? r.startedAt) > STALE_AFTER_MS) {
			r.stale = true;
		}
	}
	return [...runs.values()].toSorted((a, b) => a.startedAt - b.startedAt);
}

function fmtElapsed(run) {
	const sec =
		run.status !== "running" && typeof run.elapsedSec === "number"
			? run.elapsedSec
			: (Date.now() - run.startedAt) / 1000;
	return sec < 60
		? `${Math.round(sec)}s`
		: `${Math.floor(sec / 60)}m${String(Math.round(sec % 60)).padStart(2, "0")}s`;
}

function shortId(id) {
	return id.replace(/[^a-z0-9]/gi, "").slice(-4);
}

function activityCell(run) {
	if (run.stale) return "stale 15m".padEnd(26);
	const text = run.detail ? `${run.tool ?? "…"} · ${run.detail}` : (run.tool ?? "…");
	return text.length <= 26 ? text.padEnd(26) : `${text.slice(0, 25)}…`;
}

function render(runs) {
	if (runs.length === 0) return "no runs in the journal yet";
	const lines = [];
	const live = runs.filter((r) => r.status === "running" && !r.stale);
	const stale = runs.filter((r) => r.stale).length;
	const tail = stale > 0 ? ` · ${stale} stale` : "";
	lines.push(`pi-subagents watch · ${live.length} live · ${runs.length} total${tail} · ${path}`);
	lines.push("");
	for (const run of runs.slice(-14)) {
		const mark = run.stale
			? "⊘"
			: run.status === "running"
				? "▶"
				: run.status === "done"
					? "✔"
					: run.status === "interrupted"
						? "⊘"
						: "✖";
		const budget = (run.notes ?? []).some((n) => String(n).includes("turn budget")) ? " !cap" : "";
		const packed = run.compactions ? ` !ctx${run.compactions}` : "";
		const bit = [
			`${mark} ${shortId(run.id)}`,
			run.label.padEnd(22).slice(0, 22),
			`t${String(run.turns).padStart(3)}`,
			`${fmtElapsed(run).padStart(5)}`,
			run.stale || run.status === "running"
				? activityCell(run)
				: run.status === "error"
					? `ERR ${(run.error ?? "").slice(0, 40)}`
					: run.status === "interrupted"
						? `STOP ${(run.error ?? "").slice(0, 38)}`
						: `${run.reportChars ?? 0}ch ${run.model ?? ""}${budget}${packed}`.slice(0, 44),
		];
		lines.push(bit.join("  "));
	}
	return lines.join("\n");
}

if (asJson) {
	console.log(JSON.stringify(fold(readLines()), null, 1));
	process.exit(0);
}

if (once) {
	console.log(render(fold(readLines())));
	process.exit(0);
}

let last = "";
const draw = () => {
	const out = render(fold(readLines()));
	if (out !== last) {
		last = out;
		console.clear();
		console.log(out);
	}
};
draw();
try {
	watch(path, { persistent: true }, draw);
} catch {
	/* journal unreadable */
}
setInterval(draw, 1000);
process.on("SIGINT", () => process.exit(0));
