import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handoffRows, p50 } from "../src/telemetry/journal/handoff.ts";
import type { JournalRun } from "../src/telemetry/journal/journal-run.ts";

function run(over: Partial<JournalRun>): JournalRun {
	return {
		id: "r",
		label: "worker ab12",
		kind: "background",
		startedAt: 0,
		status: "done",
		turns: 1,
		...over,
	};
}

describe("handoff economics", () => {
	it("computes p50 and chars per 1k input tokens", () => {
		const rows = handoffRows([
			run({ id: "1", turns: 2, inputTokens: 1000, reportChars: 500 }),
			run({ id: "2", turns: 4, inputTokens: 3000, reportChars: 1500 }),
		]);
		assert.equal(rows.length, 1);
		assert.equal(rows[0]?.runs, 2);
		assert.equal(rows[0]?.p50Turns, 3);
		assert.equal(rows[0]?.p50InputTokens, 2000);
		assert.equal(rows[0]?.p50ReportChars, 1000);
		assert.equal(rows[0]?.charsPer1k, 500);
	});

	it("counts old runs as no usage data", () => {
		const rows = handoffRows([run({ id: "old" })]);
		assert.equal(rows[0]?.noUsage, 1);
		assert.equal(rows[0]?.p50InputTokens, null);
	});

	it("handles even, odd, and empty medians", () => {
		assert.equal(p50([1, 2, 3]), 2);
		assert.equal(p50([1, 2, 3, 4]), 3);
		assert.equal(p50([]), null);
	});
});
