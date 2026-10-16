/**
 * `codemode: only` — the model gets the scripting tool alone.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCodemodeFlag } from "../src/domain/subagent/frontmatter.ts";
import {
	planCodemode,
	codemodeLegs,
	withScriptRoute,
	teachesScriptRoute,
} from "../src/domain/subagent/codemode.ts";
import type { SubagentConfig } from "../src/domain/subagent/config.ts";

const sub = (over: Partial<SubagentConfig> = {}): SubagentConfig => ({
	name: "worker",
	description: "d",
	model: "inherit",
	autonomy: "inherit",
	systemPrompt: "p",
	source: "user",
	filePath: "/x.md",
	warnings: [],
	...over,
});

describe("codemode: only", () => {
	it("the flag answers with a mode", () => {
		assert.equal(parseCodemodeFlag(true).mode, true);
		assert.equal(parseCodemodeFlag("only").mode, "only");
		assert.equal(parseCodemodeFlag(undefined).mode, undefined);
		assert.match(parseCodemodeFlag("yes").error ?? "", /invalid codemode yes/);
	});

	it("only means the scripting tool alone", () => {
		const plan = planCodemode(sub({ codemode: "only" }), undefined);
		assert.ok(plan, "the plan exists");
		assert.equal(plan.mode, "only");
		assert.ok(plan.toolIds.includes("codemode"));
		assert.equal(plan.toolIds.filter((t) => t === "codemode").length, 1, "no duplicate id");
	});

	it("true means the scripting tool beside the ordinary tools", () => {
		const plan = planCodemode(sub({ codemode: true }), undefined);
		assert.ok(plan);
		assert.equal(plan.mode, "on");
	});

	it("a read-only list earns the tool and keeps its clamp", () => {
		const plan = planCodemode(sub({ codemode: "only" }), ["read", "grep", "find", "ls"]);
		assert.ok(plan, "only is an explicit ask");
		assert.equal(plan.mode, "only");
		assert.deepEqual(plan.toolIds, ["read", "grep", "find", "ls", "codemode"]);
		for (const w of ["edit", "write", "bash"]) {
			assert.ok(!plan.toolIds.includes(w), `the clamp holds: no ${w}`);
		}
	});

	it("a read-only list without the ask gets it in only mode", () => {
		const plan = planCodemode(sub(), ["read", "grep"]);
		assert.ok(plan, "the scripting tool is the default");
		assert.equal(plan.mode, "only");
		assert.deepEqual(plan.toolIds, ["read", "grep", "codemode"]);
	});

	it("a prompt that teaches scripts is left alone", () => {
		const prompt = "Batch the reads into ONE codemode script.";
		assert.ok(teachesScriptRoute(prompt));
		assert.equal(withScriptRoute(prompt), prompt);
	});

	it("a plain prompt learns the script route", () => {
		const prompt = "You are the reviewer subagent.";
		const out = withScriptRoute(prompt);
		assert.ok(out.startsWith(prompt), "the original prompt stays");
		assert.match(out, /inside codemode scripts/, "the route is taught");
		assert.match(out, /Promise\.allSettled/, "the batching rule is taught");
		assert.match(out, /one change per script/, "the edit rule is taught");
	});

	it("the fan-out counts every leg that holds a worker", () => {
		const legs = [sub({ name: "a", codemode: "only" }), sub({ name: "b" })];
		assert.deepEqual(codemodeLegs(legs), ["a", "b"]);
		assert.deepEqual(codemodeLegs([sub({ name: "c", codemode: false })]), []);
	});
});
