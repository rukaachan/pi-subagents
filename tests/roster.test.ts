/**
 * The roster scorer: 20 prompts, one table.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickRoster, scoreRoster } from "../src/domain/subagent/roster.ts";

const SUBS = [
	{ name: "code-reviewer", description: "Reviews diffs for bugs and standards." },
	{ name: "tester", description: "Writes and runs failing tests." },
	{ name: "researcher", description: "Reads papers and sources." },
	{ name: "planner", description: "Breaks work into ordered steps." },
	{ name: "explorer", description: "Finds files and maps code." },
	{ name: "worker", description: "Implements changes and fixes bugs." },
];

interface Row {
	prompt: string;
	top: string;
	expected: string[];
	rule?: string;
}

const TABLE: Row[] = [
	{
		prompt: "review the auth diff for findings",
		top: "code-reviewer",
		expected: ["code-reviewer"],
		rule: "review",
	},
	{
		prompt: "run the failing test and reproduce the regression",
		top: "tester",
		expected: ["tester"],
		rule: "test",
	},
	{
		prompt: "research papers on async agents, compare options",
		top: "researcher",
		expected: ["researcher"],
		rule: "research",
	},
	{
		prompt: "plan the migration, break down the steps",
		top: "planner",
		expected: ["planner"],
		rule: "plan",
	},
	{
		prompt: "find where the session store lives",
		top: "explorer",
		expected: ["explorer"],
		rule: "explore",
	},
	{ prompt: "implement the retry loop", top: "worker", expected: ["worker"], rule: "implement" },
	{ prompt: "refactor the journal writer", top: "worker", expected: ["worker"] },
	{ prompt: "looks good, approve this PR", top: "code-reviewer", expected: ["code-reviewer"] },
	{ prompt: "add a spec for the parser", top: "tester", expected: ["tester"] },
	{ prompt: "which file owns the codemode worker pool", top: "explorer", expected: ["explorer"] },
	{ prompt: "map the launch scheduler", top: "explorer", expected: ["explorer"] },
	{ prompt: "write a roadmap for the next phase", top: "planner", expected: ["planner"] },
	{ prompt: "fix the timeout in provider calls", top: "worker", expected: ["worker"] },
	{ prompt: "migrate config to the new schema", top: "worker", expected: ["worker"] },
	{
		prompt: "compare options for vector stores, with citations",
		top: "researcher",
		expected: ["researcher"],
	},
	{ prompt: "locate the transcript cursor", top: "explorer", expected: ["explorer"] },
	{ prompt: "build a board screen", top: "worker", expected: ["worker"] },
	{ prompt: "reproduce the regression in the retry path", top: "tester", expected: ["tester"] },
	{
		prompt: "review the plan for gaps",
		top: "code-reviewer",
		expected: ["code-reviewer", "planner"],
	},
	{ prompt: "worker: clean up the dead code", top: "worker", expected: ["worker"] },
];

describe("the roster scorer", () => {
	it("routes 20 prompts to the right legs", () => {
		for (const row of TABLE) {
			const picks = pickRoster(row.prompt, SUBS, 4);
			const names = picks.map((pick) => pick.name);
			assert.ok(picks.length >= 1, `${row.prompt}: no pick`);
			assert.equal(names[0], row.top, `${row.prompt}: picked ${names.join(", ")}`);
			for (const name of row.expected) {
				assert.ok(names.includes(name), `${row.prompt}: missing ${name} (${names.join(", ")})`);
			}
			assert.ok(
				picks.length <= row.expected.length + 1,
				`${row.prompt}: too many legs (${names.join(", ")})`,
			);
			if (row.rule) assert.equal(picks[0]?.rule, row.rule, row.prompt);
		}
	});

	it("keeps the best rule and explains the pick", () => {
		const picks = scoreRoster("run the failing test", SUBS);
		assert.equal(picks[0]?.name, "tester");
		assert.equal(picks[0]?.rule, "test");
		assert.match(picks[0]?.why ?? "", /test: "test"/);
	});

	it("honours the cap", () => {
		const picks = pickRoster("review the plan, find files, run tests, implement it", SUBS, 2);
		assert.ok(picks.length <= 2);
	});

	it("falls back to worker when nothing matches", () => {
		const picks = pickRoster("zzz qqq", SUBS, 4);
		assert.deepEqual(
			picks.map((pick) => pick.name),
			["worker"],
		);
		assert.match(picks[0]?.why ?? "", /fallback/);
	});
});
