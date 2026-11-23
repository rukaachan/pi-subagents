import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { foldJournal } from "../src/telemetry/journal-fold.ts";

describe("run grouping", () => {
	it("carries the run id from run_start", () => {
		const lines = [
			JSON.stringify({
				event: "run_start",
				id: "task_1",
				label: "explorer abc1",
				kind: "parallel",
				run: "run-parallel-1",
			}),
			JSON.stringify({
				event: "run_start",
				id: "task_2",
				label: "tester def2",
				kind: "parallel",
				run: "run-parallel-1",
			}),
			JSON.stringify({ event: "run_start", id: "task_3", label: "solo", kind: "background" }),
		];
		const runs = foldJournal(lines);
		assert.deepEqual(
			runs.map((run) => run.runId),
			["run-parallel-1", "run-parallel-1", undefined],
		);
	});
});
