/**
 * pi-subagents: what a /subagents finish roster pick costs over the six starters.
 */

import { performance } from "node:perf_hooks";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSubagentFromContent } from "../src/infra/files/index.ts";
import { pickRoster } from "../src/domain/subagent/index.ts";
import type { SubagentConfig } from "../src/domain/subagent/index.ts";

const dir = join(process.cwd(), "subagents");
const subs: SubagentConfig[] = [];
for (const file of readdirSync(dir)) {
	if (!file.endsWith(".md")) continue;
	const path = join(dir, file);
	const loaded = loadSubagentFromContent(readFileSync(path, "utf8"), path, "user");
	if (typeof loaded !== "string") subs.push(loaded);
}
if (subs.length === 0) throw new Error(`no starters in ${dir}`);

const PROMPTS = [
	"review the auth diff for findings",
	"run the failing test and reproduce the regression",
	"research papers on async agents, compare options",
	"plan the migration, break down the steps",
	"find where the session store lives",
	"implement the retry loop",
	"refactor the journal writer",
	"looks good, approve this PR",
	"add a spec for the parser",
	"which file owns the codemode worker pool",
	"map the launch scheduler",
	"write a roadmap for the next phase",
	"fix the timeout in provider calls",
	"migrate config to the new schema",
	"compare options for vector stores, with citations",
	"locate the transcript cursor",
	"build a board screen",
	"reproduce the regression in the retry path",
	"review the plan for gaps",
	"worker: clean up the dead code",
];

function percentile(sorted: number[], p: number): number {
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return sorted[index] ?? 0;
}

for (let i = 0; i < 50; i += 1) {
	for (const prompt of PROMPTS) pickRoster(prompt, subs, 4);
}

const samples: number[] = [];
let picks = 0;
for (let round = 0; round < 200; round += 1) {
	for (const prompt of PROMPTS) {
		const started = performance.now();
		picks += pickRoster(prompt, subs, 4).length;
		samples.push((performance.now() - started) * 1000);
	}
}
const sorted = samples.toSorted((a, b) => a - b);
const calls = samples.length;
console.log(`starters: ${subs.map((sub) => sub.name).join(", ")}`);
console.log(
	`roster pick: ${calls} calls · p50 ${percentile(sorted, 50).toFixed(1)} µs · p95 ${percentile(sorted, 95).toFixed(1)} µs · max ${sorted.at(-1)?.toFixed(1)} µs`,
);
console.log(`picks per prompt: ${(picks / calls).toFixed(2)}`);
for (const prompt of PROMPTS.slice(0, 6)) {
	const names = pickRoster(prompt, subs, 4).map((pick) => pick.name);
	console.log(`  ${prompt} -> ${names.join(", ")}`);
}
