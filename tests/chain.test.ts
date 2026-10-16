import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	aggregateResult,
	newChainSteps,
	stepPrompt,
	MAX_PRIOR_REPORT,
	type ChainSpec,
} from "../src/app/chain.ts";
import {
	applyRunOverrides,
	hasOverrides,
	overrideNote,
	parseComplexity,
} from "../src/domain/tiers.ts";
import type { SubagentConfig } from "../src/domain/subagent/config.ts";
import type { TaskRecord } from "../src/app/task-record.ts";
import { chainStrip } from "../src/ui/view/rows.ts";

function sub(name: string): SubagentConfig {
	return {
		name,
		description: "d",
		model: "inherit",
		autonomy: "low",
		systemPrompt: "p",
		source: "user",
		filePath: `/tmp/${name}.md`,
		warnings: [],
	};
}

const spec: ChainSpec = { steps: ["explorer", "worker", "code-reviewer"], prompt: "Ship login" };

describe("chain", () => {
	it("gives step 0 the task and later steps the prior report", () => {
		assert.equal(stepPrompt(spec, 0), "Ship login");
		const p1 = stepPrompt(spec, 1, "found auth.ts");
		assert.ok(p1.includes("found auth.ts"));
		assert.ok(p1.includes("Ship login"));
		assert.ok(p1.includes("Continue"));
	});

	it("cuts a giant prior report", () => {
		const p1 = stepPrompt(spec, 1, "z".repeat(MAX_PRIOR_REPORT + 500));
		assert.ok(p1.length < MAX_PRIOR_REPORT + 1000);
	});

	it("builds steps with only the first running", () => {
		const steps = newChainSteps(spec);
		assert.equal(steps.length, 3);
		const [s0, s1, s2] = steps;
		assert.ok(s0 && s1 && s2, "all three steps exist");
		assert.equal(s0.status, "running");
		assert.equal(s1.status, "pending");
		assert.equal(s2.idx, 2);
	});

	it("prints step progress", () => {
		const rec = {
			subagentName: "explorer",
			steps: [
				{ idx: 0, subagentName: "explorer", prompt: "", status: "done" as const },
				{ idx: 1, subagentName: "worker", prompt: "", status: "running" as const },
				{ idx: 2, subagentName: "code-reviewer", prompt: "", status: "pending" as const },
			],
		} as unknown as TaskRecord;
		assert.equal(chainStrip(rec), "explorer ✓ → worker … → code-reviewer ·");
	});

	it("aggregates step reports with summed usage", () => {
		const rec = {
			steps: [
				{ idx: 0, subagentName: "explorer", prompt: "", status: "done" as const, report: "map" },
				{ idx: 1, subagentName: "worker", prompt: "", status: "done" as const, report: "patch" },
			],
		} as unknown as TaskRecord;
		const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1 };
		const out = aggregateResult(
			[
				{ text: "map", usage, notes: ["a"] },
				{ text: "patch", usage, model: "acme/1", notes: [] },
			],
			rec,
		);
		assert.ok(out.text.includes("explorer"));
		assert.ok(out.text.includes("patch"));
		assert.equal(out.usage.turns, 2);
		assert.equal(out.usage.cost, 0.02);
		assert.equal(out.model, "acme/1");
	});

	it("says so when no step reported", () => {
		const rec = { steps: [] } as unknown as TaskRecord;
		assert.equal(aggregateResult([], rec).text, "(chain produced no report)");
	});
});

describe("tiers", () => {
	it("parses the three tiers", () => {
		assert.equal(parseComplexity("light"), "light");
		assert.equal(parseComplexity(" HEAVY "), "heavy");
		assert.equal(parseComplexity(undefined), null);
		assert.equal(parseComplexity(""), null);
		assert.equal(parseComplexity("huge"), "bad");
		assert.equal(parseComplexity(7), "bad");
	});

	it("applies model and thinking overrides on a copy", () => {
		const base = sub("explorer");
		const out = applyRunOverrides(base, { model: "acme/fast-1", complexity: "heavy" });
		assert.equal(out.model, "acme/fast-1");
		assert.equal(out.thinkingLevel, "high");
		assert.equal(base.model, "inherit");
		assert.equal(base.thinkingLevel, undefined);
	});

	it("keeps an explicit subagent thinking level", () => {
		const base = sub("explorer");
		base.thinkingLevel = "low";
		const out = applyRunOverrides(base, { complexity: "heavy" });
		assert.equal(out.thinkingLevel, "low");
	});

	it("returns the same object with no overrides", () => {
		const base = sub("explorer");
		assert.equal(applyRunOverrides(base, {}), base);
		assert.equal(hasOverrides({}), false);
		assert.equal(hasOverrides({ complexity: null }), false);
		assert.equal(hasOverrides({ model: "inherit" }), true);
	});

	it("prints an override note", () => {
		assert.equal(
			overrideNote({ complexity: "light", model: "acme/1" }),
			"complexity light · model acme/1",
		);
		assert.equal(overrideNote({}), "");
	});
});
