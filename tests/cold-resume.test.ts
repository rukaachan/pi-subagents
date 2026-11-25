/**
 * A stopped run keeps its row and its history so it can resume.
 */

import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { markStopped } from "../src/app/stop/index.ts";
import { taskOutputTool } from "../src/tools/index.ts";
import { store } from "../src/app/session/index.ts";
import { board, rec } from "./board-fixtures.ts";

const ctx = {
	cwd: "/tmp",
	sessionManager: { getSessionId: () => "s1" },
} as unknown as Parameters<typeof taskOutputTool.execute>[4];

function textOf(result: { content: { type: string; text?: string }[] }): string {
	return result.content.map((part) => part.text ?? "").join("\n");
}

describe("a stopped row", () => {
	afterEach(() => {
		for (const record of store.list()) store.remove(record.taskId);
	});

	it("keeps its history and its reason", () => {
		const row = rec({
			status: "running",
			history: [{ role: "user", content: "Task: map auth" }],
		});
		markStopped(row, "Esc", 5_000);
		assert.equal(row.status, "stopped");
		assert.equal(row.endedAt, 5_000);
		assert.equal(row.error, "interrupted by Esc");
		assert.equal(row.fullDelivered, false);
		assert.equal(row.history.length, 1, "the transcript survives the stop");
	});

	it("marks the cut chain step error and keeps later steps pending", () => {
		const row = rec({
			kind: "chain",
			status: "running",
			steps: [
				{ idx: 0, subagentName: "worker", prompt: "one", status: "running" },
				{ idx: 1, subagentName: "worker", prompt: "two", status: "pending" },
			],
		});
		markStopped(row, "TaskControl", 6_000);
		assert.deepEqual(
			row.steps?.map((step) => step.status),
			["error", "pending"],
		);
		assert.equal(row.status, "stopped");
	});

	it("sits in its own board section, hidden with failed runs", () => {
		const row = board([rec({ status: "stopped", endedAt: 2_000 })])[0];
		assert.ok(row);
		assert.equal(row.section, "stopped");
		assert.equal(row.stoppable, false);
		assert.equal(row.retryable, false);
	});

	it("tells TaskOutput to resume it by id", async () => {
		const row = rec({
			taskId: "cold-1",
			sessionId: "s1",
			status: "stopped",
			error: "interrupted by Esc",
			history: [{ role: "user", content: "Task: map auth" }],
		});
		store.add(row);
		const result = await taskOutputTool.execute(
			"call-1",
			{ task_id: "cold-1" },
			undefined,
			undefined,
			ctx,
		);
		assert.match(textOf(result), /was stopped: interrupted by Esc/);
		assert.match(textOf(result), /Resume it by id/);
		assert.equal((result.details as { status?: string }).status, "stopped");
	});
});
