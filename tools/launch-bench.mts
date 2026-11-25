/**
 * pi-subagents: offline timing for the launch code paths.
 * Run: npm run bench:launch
 */

import { renderLegFull, renderRunReport } from "../src/ui/view/run/index.ts";
import type { LaunchLeg, LaunchRun } from "../src/app/launch/index.ts";
import { TaskStore } from "../src/domain/task/index.ts";
import { MAX_LIVE_TASKS, newRecord } from "../src/domain/task/index.ts";
import { startLaunch, stopLaunchSchedulers } from "../src/app/launch/index.ts";
import { discoverSubagents } from "../src/infra/files/index.ts";
import type { SubagentConfig } from "../src/domain/subagent/index.ts";

const BODY = "line of a subagent report\n".repeat(50);

function makeLeg(i: number): LaunchLeg {
	return {
		name: `leg-${i}`,
		status: "done",
		taskId: `task-bench-${i}`,
		startedAt: 0,
		endedAt: 8000,
		report: `leg ${i}\n${BODY}`,
		usage: { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0, cost: 0.0002, turns: 3 },
		model: "test/model",
	};
}

function makeRun(n: number): LaunchRun {
	return {
		kind: "team",
		label: "bench",
		startedAt: 0,
		legs: Array.from({ length: n }, (_, i) => makeLeg(i)),
	};
}

function rows(title: string): void {
	console.log(`\n${title}`);
}

function measure(label: string, fn: () => string, runs: number): { ms: number; chars: number } {
	const t0 = performance.now();
	let out = "";
	for (let i = 0; i < runs; i += 1) out = fn();
	const ms = (performance.now() - t0) / runs;
	console.log(
		`  ${label.padEnd(22)} ${ms.toFixed(4).padStart(8)} ms/op  ${String(out.length).padStart(8)} chars`,
	);
	return { ms, chars: out.length };
}

rows("report render, compact (new default) vs every body (old default)");
for (const n of [12, 100, 1000]) {
	const run = makeRun(n);
	const loops = n >= 1000 ? 20 : 200;
	const compact = measure(
		`${n} legs compact`,
		() => renderRunReport(run, { mode: "compact" }),
		loops,
	);
	const full = measure(`${n} legs full-all`, () => run.legs.map(renderLegFull).join("\n\n"), loops);
	const ratio = (full.chars / compact.chars).toFixed(1);
	console.log(
		`  payload ${full.chars} -> ${compact.chars} chars (${ratio}x smaller), cpu ${(full.ms / compact.ms).toFixed(1)}x faster`,
	);
}

rows("discovery and admission");
const discovery = measure(
	"discover x1000",
	() => {
		const found = discoverSubagents(process.cwd());
		return found.subagents.map((s) => s.name).join(",");
	},
	1000,
);
console.log(`  discovery ${discovery.ms.toFixed(4)} ms/op`);

const names = discoverSubagents(process.cwd())
	.subagents.map((s) => s.name)
	.slice(0, 2);
if (names.length > 0) {
	const store = new TaskStore();
	const filler: SubagentConfig = {
		name: "filler",
		description: "",
		model: "inherit",
		autonomy: "low",
		systemPrompt: "p",
		source: "user",
		filePath: "f",
		warnings: [],
	};
	for (let i = 0; i < MAX_LIVE_TASKS; i += 1) {
		store.add(newRecord(filler, "fill", "/tmp", "background"));
	}
	const ctx = { cwd: process.cwd(), ui: { setStatus: () => {} } } as never;
	const admission = measure(
		"start at full store",
		() => {
			const started = startLaunch(store, "team", names, "bench prompt", ctx);
			stopLaunchSchedulers();
			return started.ok ? `queued-${started.queued}` : started.error;
		},
		200,
	);
	console.log(`  admission ${admission.ms.toFixed(4)} ms/op (${admission.chars} chars)`);
} else {
	console.log("  start at full store    (skipped: no subagents installed)");
}
