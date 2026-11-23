import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskOutputTool } from "../src/tools/task-output.ts";
import { store } from "../src/app/live-store.ts";
import { MAX_DELIVERY_CHARS } from "../src/domain/run-result.ts";
import { rec } from "./board-fixtures.ts";

const ctx = {
	cwd: "/tmp",
	sessionManager: { getSessionId: () => "s1" },
} as unknown as Parameters<typeof taskOutputTool.execute>[4];

function done(over: Record<string, unknown> = {}) {
	return rec({
		status: "done",
		sessionId: "s1",
		result: {
			text: "the report",
			usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
			notes: [],
		},
		...over,
	});
}

function call(taskId: string) {
	return taskOutputTool.execute("call-1", { task_id: taskId }, undefined, undefined, ctx);
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
	return result.content.map((part) => part.text ?? "").join("\n");
}

describe("TaskOutput delivery", () => {
	afterEach(() => {
		for (const record of store.list()) store.remove(record.taskId);
	});

	it("caps a large report before it enters the parent context", async () => {
		const record = done({
			result: {
				text: "x".repeat(MAX_DELIVERY_CHARS + 25),
				usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
				notes: ["a note"],
			},
		});
		store.add(record);
		const result = await call(record.taskId);
		const details = result.details as { truncated?: boolean; full_chars?: number } | undefined;
		assert.equal(result.isError, undefined);
		assert.match(textOf(result), /truncated \d+ chars/);
		assert.ok(textOf(result).length <= MAX_DELIVERY_CHARS + 40);
		assert.equal(details?.truncated, true);
		assert.ok((details?.full_chars ?? 0) > MAX_DELIVERY_CHARS);
	});

	it("never returns a row from another session or project", async () => {
		const other = done({ taskId: "other", sessionId: "s2" });
		store.add(other);
		const result = await call("other");
		assert.equal(result.isError, true);
		assert.match(textOf(result), /Unknown task_id/);
		assert.equal(other.fullDelivered, false);
	});
});
