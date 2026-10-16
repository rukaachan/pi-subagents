import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	MAX_TEMP_PROMPT_LINE_CHARS,
	MAX_TEMP_PROMPT_LINES,
	getTempSubagents,
	registerTemp,
	withTemps,
} from "../src/domain/temp.ts";
import { newRecord } from "../src/app/task-record.ts";
import { DEFAULT_TIMEOUT_SEC, effectiveBudget } from "../src/domain/subagent/budget.ts";
import { taskDetail } from "../src/ui/view/detail.ts";
import { taskRow } from "../src/ui/view/rows.ts";
import type { SubagentConfig } from "../src/domain/subagent/config.ts";
import type { SubagentDiscoveryResult } from "../src/domain/subagent/discovery.ts";

const disk = (names: string[]): SubagentDiscoveryResult => ({
	subagents: names.map((name) => mkDisk(name)),
	errors: [],
	userSubagentsDir: "/u",
	projectSubagentsDir: null,
});

const mkDisk = (name: string): SubagentConfig => ({
	name,
	description: "d",
	model: "inherit",
	autonomy: "low",
	systemPrompt: "p",
	source: "user",
	filePath: "/x",
	warnings: [],
});

describe("session-temp subagents (grill 2026-10-20)", () => {
	it("holds the ratified caps (20 lines, 120 chars/line)", () => {
		assert.equal(MAX_TEMP_PROMPT_LINES, 20);
		assert.equal(MAX_TEMP_PROMPT_LINE_CHARS, 120);
	});

	it("registers a valid temp with defaults filled", () => {
		const r = registerTemp(
			{
				name: "t-doctor",
				description: "fix triage",
				systemPrompt: "You are a triage doctor.\nBe terse.",
			},
			["explorer", "worker"],
		);
		assert.equal(r.ok, true);
		if (r.ok) {
			assert.equal(r.replaced, false);
			assert.equal(r.sub.source, "temp");
			assert.equal(r.sub.model, "inherit");
			assert.equal(r.sub.autonomy, "inherit");
			assert.equal(r.sub.codemode, undefined);
			assert.equal(r.sub.filePath, "(session temp)");
			assert.equal(r.sub.budget, undefined);
		}
	});

	it("refuses to shadow a persistent starter", () => {
		const r = registerTemp({ name: "explorer", description: "d", systemPrompt: "You are." }, [
			"explorer",
			"worker",
		]);
		assert.equal(r.ok, false);
		if (!r.ok) assert.match(r.error, /persistent starter/);
	});

	it("refuses malformed names outright", () => {
		for (const name of ["", "A-upper", "x".repeat(33), "-lead", "sp ace", "t!"]) {
			const r = registerTemp({ name, description: "d", systemPrompt: "p" }, []);
			assert.equal(r.ok, false, `expected refusal for ${JSON.stringify(name)}`);
		}
	});

	it("caps the system prompt at 20 lines", () => {
		const prompt = Array.from({ length: 21 }, (_, i) => `line-${i}`).join("\n");
		const r = registerTemp({ name: "t-long", description: "d", systemPrompt: prompt }, []);
		assert.equal(r.ok, false);
		if (!r.ok) assert.match(r.error, /has 21 lines/);
	});

	it("caps each line at 120 characters, naming the offender", () => {
		const prompt = `short\n${"x".repeat(121)}\nshort`;
		const r = registerTemp({ name: "t-fat", description: "d", systemPrompt: prompt }, []);
		assert.equal(r.ok, false);
		if (!r.ok) {
			assert.match(r.error, /line 2/);
			assert.match(r.error, /121 characters/);
		}
	});

	it("caps the description and demands non-empty fields", () => {
		const fat = registerTemp({ name: "t-d1", description: "x".repeat(201), systemPrompt: "p" }, []);
		assert.equal(fat.ok, false);
		if (!fat.ok) assert.match(fat.error, /at most 200/);
		for (const bad of [
			{ name: "t-d2", description: "   ", systemPrompt: "p" },
			{ name: "t-d3", description: "ok", systemPrompt: " \n " },
			{ name: "t-d4", description: 7 as unknown, systemPrompt: "p" },
		]) {
			const r = registerTemp(bad, []);
			assert.equal(r.ok, false);
		}
	});

	it("replacement is last-wins inside the session, echoed", () => {
		const a = registerTemp({ name: "t-reuse", description: "v1", systemPrompt: "v1" }, []);
		const b = registerTemp({ name: "t-reuse", description: "v2", systemPrompt: "v2" }, []);
		assert.equal(a.ok && b.ok, true);
		if (b.ok) {
			assert.equal(b.replaced, true);
			assert.equal(getTempSubagents().filter((s) => s.name === "t-reuse").length, 1);
			assert.equal(getTempSubagents().find((s) => s.name === "t-reuse")?.description, "v2");
		}
	});

	it("forwards budget parse errors and accepts valid budgets", () => {
		const bad = registerTemp(
			{ name: "t-b1", description: "d", systemPrompt: "p", budget: { maxTurns: -1 } },
			[],
		);
		assert.equal(bad.ok, false);
		if (!bad.ok) assert.match(bad.error, /non-negative integer/);
		const good = registerTemp(
			{
				name: "t-b2",
				description: "d",
				systemPrompt: "p",
				budget: { maxTurns: 3, timeoutSec: 900, maxReportChars: 500 },
			},
			[],
		);
		assert.equal(good.ok, true);
		if (good.ok) {
			assert.deepEqual(good.sub.budget, { maxTurns: 3, timeoutSec: 900, maxReportChars: 500 });
		}
	});

	it("no temp can run unbounded: the system timeout fills a bare budget", () => {
		const bare = registerTemp({ name: "t-clk1", description: "d", systemPrompt: "p" }, []);
		assert.equal(bare.ok, true);
		if (bare.ok) assert.equal(effectiveBudget(bare.sub.budget).timeoutSec, DEFAULT_TIMEOUT_SEC);
	});

	it("codemode off/on normalize to booleans", () => {
		const off = registerTemp(
			{ name: "t-off", description: "d", systemPrompt: "p", codemode: "off" },
			[],
		);
		assert.equal(off.ok, true);
		if (off.ok) assert.equal(off.sub.codemode, false);
		const on = registerTemp(
			{ name: "t-on", description: "d", systemPrompt: "p", codemode: "on" },
			[],
		);
		assert.equal(on.ok, true);
		if (on.ok) assert.equal(on.sub.codemode, true);
	});

	it("codemode only passes through as a mode", () => {
		const ok = registerTemp(
			{ name: "t-only", description: "d", systemPrompt: "p", codemode: "only" },
			[],
		);
		assert.equal(ok.ok, true);
		if (ok.ok) assert.equal(ok.sub.codemode, "only");
		const bad = registerTemp(
			{ name: "t-bad", description: "d", systemPrompt: "p", codemode: "beside" },
			[],
		);
		assert.equal(bad.ok, false);
	});

	it("codemode and tools pass through; bad tools refuse", () => {
		const ok = registerTemp(
			{
				name: "t-cm",
				description: "d",
				systemPrompt: "p",
				codemode: true,
				tools: ["read", "grep"],
			},
			[],
		);
		assert.equal(ok.ok, true);
		if (ok.ok) {
			assert.equal(ok.sub.codemode, true);
			assert.deepEqual(ok.sub.tools, ["read", "grep"]);
		}
		const badTool = registerTemp(
			{ name: "t-bt", description: "d", systemPrompt: "p", tools: [123] },
			[],
		);
		assert.equal(badTool.ok, false);
	});

	it("withTemps merges registry into disk discovery; dirs and errors pass through", () => {
		registerTemp({ name: "t-merge", description: "d", systemPrompt: "p" }, []);
		const merged = withTemps(disk(["aaa-disk"]));
		assert.ok(merged.subagents.some((s) => s.name === "aaa-disk"));
		assert.ok(merged.subagents.some((s) => s.name === "t-merge"));
		assert.deepEqual(merged.errors, []);
		assert.equal(merged.userSubagentsDir, "/u");
	});

	it("badges temp rows and details, plain names stay plain", () => {
		const temp = registerTemp({ name: "t-badge", description: "badge me", systemPrompt: "p" }, []);
		assert.equal(temp.ok, true);
		if (temp.ok) {
			const rec = newRecord(temp.sub, "label", "/cwd", "background");
			assert.match(taskRow(rec), /◌ t-badge/);
			assert.match(taskDetail(rec), /temp \(session-scoped\)/);
		}
		const plain = newRecord(mkDisk("worker"), "label", "/cwd", "background");
		assert.match(taskRow(plain), /worker/);
		assert.doesNotMatch(taskRow(plain), /◌ worker/);
	});

	it("all registered temps come out name-sorted", () => {
		const names = getTempSubagents().map((s) => s.name);
		assert.deepEqual(
			names,
			[...names].toSorted((a, b) => a.localeCompare(b)),
		);
	});
});
