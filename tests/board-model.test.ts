/**
 * The board model: sections, run grouping, and per-row numbers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { board, rec, usage } from "./board-fixtures.ts";

describe("the board model", () => {
	it("sorts queued, running, done, failed and names each row", () => {
		const rows = board([
			rec({ taskId: "a", status: "done", startedAt: 1_000, endedAt: 4_000 }),
			rec({
				taskId: "b",
				status: "error",
				startedAt: 1_000,
				endedAt: 3_000,
				failure: "verification",
			}),
			rec({ taskId: "c", startedAt: 2_000 }),
			rec({ taskId: "d" }),
		]);
		assert.deepEqual(
			rows.map((r) => [r.taskId, r.section]),
			[
				["d", "queued"],
				["c", "running"],
				["a", "done"],
				["b", "failed"],
			],
		);
		assert.equal(rows[2]?.elapsedSec, 3);
		assert.equal(rows[3]?.failure, "verification");
	});

	it("freezes a settled row when endedAt was never saved", () => {
		const rows = board(
			[
				rec({
					status: "error",
					createdAt: 1_000,
					history: [{ timestamp: 5_000 }],
				}),
			],
			[],
			100_000,
		);
		assert.equal(rows[0]?.elapsedSec, 4);
		assert.equal(rows[0]?.label, "map the engine");
	});

	it("keeps the legs of one run together", () => {
		const rows = board([
			rec({ taskId: "a", runId: "run-parallel-x1" }),
			rec({ taskId: "b", runId: "run-parallel-x2" }),
			rec({ taskId: "c", runId: "run-parallel-x1" }),
		]);
		assert.deepEqual(
			rows.map((r) => r.taskId),
			["a", "c", "b"],
		);
	});

	it("carries turns, tokens, cost, and the retry flag", () => {
		const rows = board([
			rec({
				status: "error",
				startedAt: 1_000,
				endedAt: 9_000,
				prompt: "go",
				result: { text: "x", usage: usage(3, 8_100, 0.0031), notes: [] },
			}),
		]);
		const row = rows[0];
		assert.equal(row?.turns, 3);
		assert.equal(row?.tokens, 8_100);
		assert.equal(row?.cost, 0.0031);
		assert.equal(row?.retryable, true);
	});
});
