#!/usr/bin/env node
/**
 * pi-subagents: re-fit the stall floor from the run journal.
 *
 * Usage:
 *   npx tsx tools/stall-fit.mts [--path journal.ndjson]
 */

import { defaultJournalPath, foldJournalFile } from "../src/telemetry/journal.ts";

const args = process.argv.slice(2);
const pathIndex = args.indexOf("--path");
const path = pathIndex >= 0 ? (args[pathIndex + 1] ?? defaultJournalPath()) : defaultJournalPath();

const runs = foldJournalFile(path).filter((r) => r.status !== "running");
const withGaps = runs.filter((r) => typeof r.gapMaxSec === "number");

function percentile(values: number[], f: number): number {
	const sorted = values.toSorted((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] ?? 0;
}

console.log(`journal: ${path}`);
console.log(`completed runs: ${runs.length}`);
console.log(`runs with gap data: ${withGaps.length} (older runs predate the field)`);
if (withGaps.length === 0) {
	console.log("nothing to fit yet: run a few subagents, then re-run this script.");
	process.exit(0);
}

const maxima = withGaps.map((r) => r.gapMaxSec ?? 0);
const gaps = withGaps.reduce((sum, r) => sum + (r.gapOver60 ?? 0), 0);
console.log(
	`per-run longest silence: p50=${percentile(maxima, 0.5)}s p90=${percentile(maxima, 0.9)}s ` +
		`p99=${percentile(maxima, 0.99)}s max=${Math.max(...maxima)}s`,
);
console.log(`silences >= 60s in total: ${gaps}`);

console.log("\nfloor   runs cut   of   worst case it would have killed");
for (const floor of [120, 300, 600, 900, 1200, 1800, 3600, 5400]) {
	const cut = withGaps.filter((r) => (r.gapMaxSec ?? 0) > floor);
	const worst = cut.toSorted((a, b) => (b.gapMaxSec ?? 0) - (a.gapMaxSec ?? 0))[0];
	const detail = worst
		? `${worst.label} (${worst.kind}, silence ${worst.gapMaxSec}s, run ${worst.elapsedSec ?? "?"}s)`
		: "-";
	console.log(
		`${String(floor).padStart(5)}s  ${String(cut.length).padStart(8)}   ${`of ${withGaps.length}`.padStart(9)}   ${detail}`,
	);
}

const top = withGaps.toSorted((a, b) => (b.gapMaxSec ?? 0) - (a.gapMaxSec ?? 0)).slice(0, 5);
console.log("\nlongest silences:");
for (const r of top) {
	console.log(
		`  ${String(r.gapMaxSec ?? 0).padStart(5)}s  ${r.label} [${r.kind}]  run ${r.elapsedSec ?? "?"}s, ${r.turns} turns, ${r.gapOver60 ?? 0} pauses >=60s`,
	);
}
