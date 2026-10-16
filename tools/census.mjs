#!/usr/bin/env node
/**
 * pi-subagents: count and summarise journal runs.
 *
 * Usage:
 *   node tools/census.mjs [--since ts] [--label name]
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const statePath =
	process.env.PI_SUBAGENTS_STATE ?? join(homedir(), ".pi", "agent", "pi-subagents-state.json");
const args = process.argv.slice(2);
const sinceIdx = args.indexOf("--since");
const labelIdx = args.indexOf("--label");
const since = sinceIdx >= 0 ? Number(args[sinceIdx + 1]) : undefined;
const label = labelIdx >= 0 ? args[labelIdx + 1] : undefined;

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const CAP = 60;

const db = JSON.parse(readFileSync(statePath, "utf8"));
const tasks = Object.values(db.tasks ?? {});
const runs = tasks
	.filter((t) => Array.isArray(t.history) && t.history.length > 0)
	.filter((t) => {
		if (since === undefined || Number.isNaN(since)) return true;
		const started =
			typeof t.startedAt === "number" ? t.startedAt : Date.parse(t.startedAt ?? "") || 0;
		const sinceMs = since < 1e12 ? since * 1000 : since;
		return started >= sinceMs;
	});

let singleReadTurns = 0;
let multiToolTurns = 0;
let readCalls = 0;
let capped = 0;
let codemodeCalls = 0;
let runsWithCodemode = 0;
let maxStreak = 0;
let budgetCapped = 0;
const budgetCappedRuns = [];
const streaks = [];

for (const run of runs) {
	if (run.history.length >= CAP) capped++;
	const notes = run.result?.notes ?? [];
	if (notes.some((n) => String(n).includes("turn budget"))) {
		budgetCapped++;
		budgetCappedRuns.push(run.taskId);
	}
	let streak = 0;
	let runCodemode = 0;
	for (const m of run.history) {
		if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
		const calls = m.content.filter((c) => c.type === "toolCall");
		const readCallsHere = calls.filter((c) => READ_TOOLS.has(c.name));
		readCalls += readCallsHere.length;
		if (calls.some((c) => c.name === "codemode")) {
			runCodemode++;
			codemodeCalls++;
			continue; // a codemode turn ends a read streak by design
		}
		if (calls.length === 1 && readCallsHere.length === 1) {
			singleReadTurns++;
			streak++;
		} else if (calls.length > 1) {
			multiToolTurns++;
		} else {
			streak = 0; // prose or thinking turn breaks the streak
			continue;
		}
		if (streak > 0) {
			maxStreak = Math.max(maxStreak, streak);
		} else if (streak === 0 && readCallsHere.length === 0) {
		}
		if (calls.length === 0) streak = 0;
	}
	if (runCodemode > 0) {
		runsWithCodemode++;
		streaks.push(...collectStreaks(run.history));
	}
}

function collectStreaks(history) {
	const out = [];
	let cur = 0;
	for (const m of history) {
		if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
		const calls = m.content.filter((c) => c.type === "toolCall");
		if (calls.some((c) => c.name === "codemode")) {
			if (cur > 0) out.push(cur);
			cur = 0;
			continue;
		}
		const readCallsHere = calls.filter((c) => READ_TOOLS.has(c.name));
		if (calls.length === 1 && readCallsHere.length === 1) cur++;
		else if (calls.length === 0) {
			if (cur > 0) out.push(cur);
			cur = 0;
		}
	}
	if (cur > 0) out.push(cur);
	return out;
}

const out = {
	budgetCapped,
	budgetCappedRunIds: budgetCappedRuns,
	label: label ?? undefined,
	since: since ?? undefined,
	runs: runs.length,
	runsWithCodemode,
	codemodeCalls,
	capped,
	singleReadTurns,
	multiToolTurns,
	readCalls,
	maxReadStreak: maxStreak,
	readStreaks: streaks,
	avgStreak: streaks.length
		? Math.round((streaks.reduce((a, b) => a + b, 0) / streaks.length) * 100) / 100
		: 0,
};
console.log(JSON.stringify(out, null, 2));
