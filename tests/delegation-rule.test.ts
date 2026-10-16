/**
 * The delegation rule is the package's only standing instruction that makes a model delegate without being asked.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DELEGATION_RULE, taskMeta } from "../src/tools/task/meta.ts";
import { subagentAliasTool } from "../src/tools/subagent-alias.ts";

describe("the delegation rule", () => {
	it("is attached to Task", () => {
		assert.deepEqual(taskMeta.promptGuidelines, [DELEGATION_RULE]);
	});

	it("is attached to the subagent alias with the same words", () => {
		const guidelines = (subagentAliasTool as { promptGuidelines?: string[] }).promptGuidelines;
		assert.deepEqual(guidelines, [DELEGATION_RULE], "identical text is what pi dedupes");
	});

	it("names the triggers and the keep-local case", () => {
		for (const phrase of [
			"3+ files",
			"2+ modules",
			"8 tool calls",
			"parallel",
			"2 minutes",
			"one-file change",
		]) {
			assert.ok(DELEGATION_RULE.includes(phrase), `the rule lost "${phrase}"`);
		}
	});

	it("stays one short line, so it costs almost nothing", () => {
		assert.ok(!DELEGATION_RULE.includes("\n"), "a newline would break the rules list");
		assert.ok(DELEGATION_RULE.length < 400, `rule is ${DELEGATION_RULE.length} chars`);
	});
});
