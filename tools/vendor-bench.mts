/**
 * pi-subagents: what the vendor features cost on the cold path.
 */
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { readGlobalConfig } from "../src/app/global-config.ts";
import { finishPayload, runFinishHook } from "../src/telemetry/notify/index.ts";
import { journalWrite } from "../src/telemetry/journal/index.ts";
import { FooterProgress } from "../src/telemetry/live/index.ts";

const payload = finishPayload({
	task_id: "task-bench",
	subagent: "explorer",
	status: "done",
	ms: 1234,
	chars: 560,
	model: "acme/fast",
	cwd: "/tmp/project",
});

function time(fn: () => void, runs: number): number {
	const started = performance.now();
	for (let i = 0; i < runs; i += 1) fn();
	return performance.now() - started;
}

function pct(values: number[], p: number): number {
	const sorted = values.toSorted((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

function table(title: string, rows: [string, string][]): void {
	console.log(`\n${title}`);
	const width = rows.reduce((n, [key]) => Math.max(n, key.length), 0);
	for (const [key, value] of rows) console.log(`  ${key.padEnd(width)}  ${value}`);
}

// 1. The unset guard: a blank command never spawns.
const guardTotal = time(() => runFinishHook("   ", payload), 100_000);

// 2. A real spawn, one at a time so each sample owns its child.
const spawns: number[] = [];
for (let i = 0; i < 20; i += 1) {
	const started = performance.now();
	const child = runFinishHook("true", payload, 5000);
	if (child) {
		child.ref();
		await once(child, "exit");
	}
	spawns.push(performance.now() - started);
}

// 3. Settings read vs a resolved cap.
const configTotal = time(() => readGlobalConfig(process.cwd()), 200);
const global = readGlobalConfig(process.cwd());
const capReads = time(() => {
	const cap = global.liveCap ?? 12;
	if (cap < 0) throw new Error("unreachable");
}, 1_000_000);

// 4. Footer finish, no hook configured.
const footer = new FooterProgress({ ttlMs: 60_000 });
const footerTotal = time(() => {
	const key = `k${Math.random()}`;
	footer.start(key, "explorer");
	footer.finish(key, { status: "done" });
}, 10_000);
footer.clearDone();

// 5. Failure label: one journal append, the only write it adds.
const dir = mkdtempSync(join(tmpdir(), "pi-bench-"));
const previous = process.env.PI_SUBAGENTS_JOURNAL;
process.env.PI_SUBAGENTS_JOURNAL = join(dir, "journal.ndjson");
const journalTotal = time(
	() => journalWrite({ event: "failure", id: "task-bench", family: "spec" }),
	1000,
);
if (previous === undefined) delete process.env.PI_SUBAGENTS_JOURNAL;
else process.env.PI_SUBAGENTS_JOURNAL = previous;
rmSync(dir, { recursive: true, force: true });

table("finish hook", [
	["unset guard, 100k", `${(guardTotal * 1000).toFixed(0)} µs total`],
	["unset guard, per run", `${((guardTotal * 1000) / 100_000).toFixed(3)} µs`],
	["spawn `true`, p50", `${pct(spawns, 0.5).toFixed(2)} ms`],
	["spawn `true`, p95", `${pct(spawns, 0.95).toFixed(2)} ms`],
]);
table("settings", [
	["readGlobalConfig, per call", `${(configTotal / 200).toFixed(3)} ms`],
	["resolved cap read", `${((capReads * 1_000_000) / 1_000_000).toFixed(0)} ns`],
]);
table("footer finish", [["10k runs, per run", `${((footerTotal * 1000) / 10_000).toFixed(2)} µs`]]);
table("failure label", [
	["journal append, per label", `${((journalTotal * 1000) / 1000).toFixed(2)} µs`],
]);
