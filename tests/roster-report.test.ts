import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeRoster, type RosterRun } from "../src/domain/run/index.ts";

function run(over: Partial<RosterRun> & { id: string }): RosterRun {
	return { status: "done", turns: 2, startedAt: 1, ...over };
}

describe("roster report", () => {
	it("returns an empty report for an empty journal", () => {
		assert.deepEqual(summarizeRoster([]), { runs: 0, groups: 0, context: [], bySize: [] });
	});

	it("summarizes one run and its turn bucket", () => {
		const report = summarizeRoster([
			run({ id: "a", turns: 3, inputTokens: 100, promptChars: 10, reportChars: 20 }),
		]);
		assert.equal(report.runs, 1);
		assert.equal(report.groups, 1);
		assert.deepEqual(report.context, [{ label: "0-4", runs: 1, avgInputTokens: 100 }]);
		assert.deepEqual(report.bySize, [{ size: 1, groups: 1, successRate: 1 }]);
		assert.equal(report.recommendation, 1);
	});

	it("measures handoff tax between adjacent runs in one group", () => {
		const report = summarizeRoster([
			run({ id: "a", runId: "g", startedAt: 1, reportChars: 100 }),
			run({ id: "b", runId: "g", startedAt: 2, promptChars: 50, reportChars: 80 }),
			run({ id: "c", runId: "g", startedAt: 3, promptChars: 40 }),
		]);
		assert.equal(report.groups, 1);
		assert.equal(report.bySize[0]?.size, 3);
		assert.equal(report.handoffTax, 0.5);
	});

	it("recommends the smallest roster within ten percent of the best", () => {
		const report = summarizeRoster([
			run({ id: "a", runId: "one", status: "error" }),
			run({ id: "b", runId: "two" }),
			run({ id: "c", runId: "two" }),
			run({ id: "d", runId: "four" }),
			run({ id: "e", runId: "four" }),
			run({ id: "f", runId: "four" }),
			run({ id: "g", runId: "four" }),
		]);
		assert.deepEqual(
			report.bySize.map((row) => [row.size, row.groups, row.successRate]),
			[
				[1, 1, 0],
				[2, 1, 1],
				[4, 1, 1],
			],
		);
		assert.equal(report.recommendation, 2);
	});
});
