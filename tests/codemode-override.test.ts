/**
 * Per-run codemode: the Task switch that beats the file for one run.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyRunOverrides, overrideNote, parseCodemodeOverride } from "../src/domain/tiers.ts";
import { planCodemode } from "../src/domain/subagent/codemode.ts";
import type { SubagentConfig } from "../src/domain/subagent/config.ts";
import { planTask } from "../src/tools/task/validate.ts";
import type { TaskParams } from "../src/tools/task/schema.ts";

const sub = (over: Partial<SubagentConfig> = {}): SubagentConfig => ({
	name: "probe",
	description: "d",
	model: "inherit",
	autonomy: "low",
	codemode: "only",
	systemPrompt: "p",
	source: "user",
	filePath: "/tmp/x.md",
	warnings: [],
	...over,
});

describe("parseCodemodeOverride", () => {
	it("takes off, on, only, and the boolean forms", () => {
		assert.equal(parseCodemodeOverride("off"), false);
		assert.equal(parseCodemodeOverride("on"), true);
		assert.equal(parseCodemodeOverride("only"), "only");
		assert.equal(parseCodemodeOverride(false), false);
		assert.equal(parseCodemodeOverride(true), true);
	});

	it("treats absence as no override, anything else as bad", () => {
		assert.equal(parseCodemodeOverride(undefined), null);
		assert.equal(parseCodemodeOverride(""), null);
		assert.equal(parseCodemodeOverride("sometimes"), "bad");
	});
});

describe("applyRunOverrides with codemode", () => {
	it("off removes the scripting tool for this run only", () => {
		const base = sub();
		const out = applyRunOverrides(base, { codemode: false });
		assert.equal(out.codemode, false);
		assert.equal(planCodemode(out, ["read", "grep"], undefined), null);
		assert.equal(base.codemode, "only", "the source config is not mutated");
	});

	it("on keeps the scripting tool beside the ordinary tools", () => {
		const out = applyRunOverrides(sub(), { codemode: true });
		assert.equal(planCodemode(out, ["read"], undefined)?.mode, "on");
	});

	it("only gives the scripting tool alone", () => {
		const out = applyRunOverrides(sub({ codemode: false }), { codemode: "only" });
		assert.equal(planCodemode(out, ["read"], undefined)?.mode, "only");
	});

	it("names the switch in the override note", () => {
		assert.match(overrideNote({ codemode: false }), /codemode off/);
		assert.match(overrideNote({ codemode: true }), /codemode on/);
		assert.match(overrideNote({ codemode: "only" }), /codemode only/);
	});
});

describe("planTask carries the codemode switch", () => {
	const base = { subagent_type: "probe", description: "d", prompt: "p" } as TaskParams;

	it("accepts the string and boolean forms", () => {
		for (const value of [false, true, "off", "on", "only"] as const) {
			const plan = planTask({ ...base, codemode: value });
			assert.ok(plan.ok, `codemode ${String(value)} should plan`);
			if (plan.ok)
				assert.equal(
					plan.plan.overrides.codemode,
					value === "off" ? false : value === "on" ? true : value,
				);
		}
	});

	it("refuses an unknown value with one clear line", () => {
		const plan = planTask({ ...base, codemode: "sometimes" as never });
		assert.equal(plan.ok, false);
		if (!plan.ok) {
			const text = plan.error.content[0];
			assert.ok(text?.type === "text" && text.text.includes("Use off, on, or only"));
		}
	});
});
