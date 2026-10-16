import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DISPATCH_RULES, dispatchSubagent } from "../src/domain/dispatch.ts";

describe("dispatchSubagent (nameless Task)", () => {
	it("routes the knife-edge prompts the way a human would", () => {
		const cases: Array<[string, string]> = [
			["review the login fix", "code-reviewer"],
			["test the login flow", "tester"],
			["fix the login bug", "worker"],
			["find where sessions are stored", "explorer"],
			["plan the migration approach", "planner"],
			["research papers on caching", "researcher"],
		];
		for (const [text, want] of cases) {
			const v = dispatchSubagent(text);
			assert.ok(v.kind === "picked", `"${text}" must pick, got ${v.kind}`);
			assert.equal(v.subagent, want, `"${text}" routes wrong`);
		}
	});

	it("every pick echoes the rule and keyword that fired", () => {
		const v = dispatchSubagent("review the login fix");
		assert.ok(v.kind === "picked");
		assert.equal(v.rule, "review");
		assert.equal(v.matched, "review");
	});

	it("respects word boundaries: fixx is not fix", () => {
		assert.equal(dispatchSubagent("fixx the typo").kind, "none");
		assert.equal(dispatchSubagent("untested theory").kind, "none");
	});

	it("fails clean instead of guessing", () => {
		assert.deepEqual(dispatchSubagent("do the thing please"), { kind: "none" });
		assert.deepEqual(dispatchSubagent(""), { kind: "none" });
	});

	it("review outranks worker for fix-containing review prompts", () => {
		const v = dispatchSubagent("review it and fix whatever it broke");
		assert.ok(v.kind === "picked");
		assert.equal(v.subagent, "code-reviewer");
	});

	it("two specialist rules is ambiguous, refused not guessed", () => {
		const v = dispatchSubagent("review the test results");
		assert.deepEqual(v, { kind: "ambiguous", rules: ["review", "test"] });
	});

	it("worker alone still routes to worker", () => {
		const v = dispatchSubagent("implement a retry helper");
		assert.ok(v.kind === "picked");
		assert.equal(v.subagent, "worker");
	});

	it("table covers exactly the six starters in specificity order", () => {
		assert.deepEqual(
			DISPATCH_RULES.map((r) => r.subagent),
			["code-reviewer", "tester", "researcher", "planner", "explorer", "worker"],
		);
	});
});
