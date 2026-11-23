import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeState, STATE_VERSION } from "../src/infra/state-file.ts";
import { rec } from "./board-fixtures.ts";

function done(over: Record<string, unknown> = {}) {
	return rec({
		status: "done",
		result: {
			text: "the report",
			usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
			notes: [],
		},
		...over,
	});
}

function state(tasks: unknown[], ledger: unknown = {}) {
	return decodeState(JSON.stringify({ version: STATE_VERSION, savedAt: 1, tasks, ledger }));
}

describe("state decoding", () => {
	it("drops malformed rows instead of trusting the disk", () => {
		const parsed = state(
			[
				done({ taskId: "task-good" }),
				done({ taskId: "task-bad" }),
				{ ...done({ taskId: "task-nocwd" }), cwd: undefined },
				{ ...done({ taskId: "task-nosub" }), subagent: "nope" },
				{ ...done({ taskId: "task-status" }), status: "pending" },
				{ ...done({ taskId: "task-good" }), description: "duplicate" },
			],
			{ explorer: { total: "many" } },
		);
		assert.ok(parsed);
		assert.deepEqual(
			parsed.tasks.map((task) => task.taskId),
			["task-good", "task-bad"],
		);
		assert.deepEqual(parsed.ledger, {});
	});

	it("keeps a row but drops a result that would crash the reader", () => {
		const parsed = state([
			done({ taskId: "task-res", result: { text: 3, usage: {}, notes: [] } }),
			done({ taskId: "task-use", result: { text: "ok", usage: { input: 1 }, notes: [] } }),
		]);
		assert.ok(parsed);
		assert.equal(parsed.tasks.length, 2);
		assert.equal(parsed.tasks[0]?.result, undefined);
		assert.equal(parsed.tasks[1]?.result, undefined);
	});

	it("normalizes the nested records the UI reads", () => {
		const parsed = state([
			done({
				taskId: "task-nested",
				subagent: { name: "explorer" },
				steps: [{ subagentName: "worker", status: "weird" }, { status: "running" }],
				legs: [{ subagentName: "tester", taskId: 4, status: "done" }],
			}),
		]);
		const task = parsed?.tasks[0];
		assert.ok(task);
		assert.equal(task.subagent.description, "");
		assert.equal(task.subagent.model, "inherit");
		assert.equal(task.subagent.autonomy, "low");
		assert.deepEqual(
			task.steps?.map((step) => step.subagentName),
			["worker"],
		);
		assert.equal(task.steps?.[0]?.status, "pending");
		assert.equal(task.legs?.[0]?.taskId, undefined);
	});
});
