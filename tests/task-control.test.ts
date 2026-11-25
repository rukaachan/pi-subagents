import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskControlTool } from "../src/tools/index.ts";
import { store } from "../src/app/session/index.ts";
import { registerLiveSession } from "../src/app/live/index.ts";
import { registerLive, liveCount } from "../src/app/live/index.ts";
import { takeSteers } from "../src/app/live/index.ts";
import type { TaskRecord } from "../src/domain/task/index.ts";

const ctx = {
	cwd: "/tmp",
	sessionManager: { getSessionId: () => "s1" },
} as unknown as Parameters<typeof taskControlTool.execute>[4];

function record(over: Partial<TaskRecord> = {}): TaskRecord {
	return {
		taskId: "task_ctrl_1",
		subagentName: "explorer",
		description: "map the auth module",
		status: "running",
		createdAt: Date.now(),
		fullDelivered: false,
		subagent: {
			name: "explorer",
			description: "d",
			model: "inherit",
			autonomy: "off",
			systemPrompt: "p",
			source: "user",
			filePath: "/tmp/x.md",
			warnings: [],
		},
		cwd: "/tmp",
		sessionId: "s1",
		history: [],
		prompt: "find the auth module",
		...over,
	};
}

function call(action: "steer" | "retry" | "stop", taskId: string, text?: string) {
	return taskControlTool.execute(
		"call-1",
		{ action, task_id: taskId, ...(text ? { text } : {}) },
		undefined,
		undefined,
		ctx,
	);
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
	return result.content.map((part) => part.text ?? "").join("\n");
}

describe("TaskControl", () => {
	afterEach(() => {
		for (const rec of store.list()) store.remove(rec.taskId);
	});

	it("steers a live leg and journals the text", async () => {
		const seen: string[] = [];
		store.add(record());
		const off = registerLiveSession("task_ctrl_1", {
			messages: () => [],
			steer: async (text) => {
				seen.push(text);
				return true;
			},
		});
		try {
			const result = await call("steer", "task_ctrl_1", "skip the CLI, read the API only");
			assert.equal(result.isError, undefined);
			assert.deepEqual(seen, ["skip the CLI, read the API only"]);
			assert.match(textOf(result), /Steered task_ctrl_1 \(explorer\)/);
		} finally {
			off();
		}
	});

	it("refuses a steer without text or on a finished leg", async () => {
		store.add(record());
		assert.match(textOf(await call("steer", "task_ctrl_1")), /needs text/);
		store.remove("task_ctrl_1");
		store.add(record({ status: "done" }));
		assert.match(textOf(await call("steer", "task_ctrl_1", "x")), /not running \(done\)/);
	});

	it("queues a steer that arrives before the child session exists", async () => {
		store.add(record());
		const result = await call("steer", "task_ctrl_1", "read the API only");
		assert.equal(result.isError, undefined);
		assert.match(textOf(result), /Queued a steer/);
		assert.deepEqual(takeSteers("task_ctrl_1"), ["read the API only"]);
	});

	it("stops one live leg and drops its row", async () => {
		store.add(record());
		let stopped = "";
		const off = registerLive("task_ctrl_1", "explorer ctrl", (why) => {
			stopped = why;
			store.remove("task_ctrl_1");
		});
		const result = await call("stop", "task_ctrl_1");
		off();
		assert.equal(result.isError, undefined);
		assert.equal(stopped, "TaskControl");
		assert.equal(store.get("task_ctrl_1"), undefined);
		assert.equal(liveCount(), 0);
	});

	it("refuses a stop on a finished leg or an unknown id", async () => {
		store.add(record({ status: "error", error: "boom" }));
		assert.match(textOf(await call("stop", "task_ctrl_1")), /not running \(error\)/);
		assert.match(textOf(await call("stop", "ghost")), /Unknown task_id/);
	});

	it("never reaches a row from another session or project", async () => {
		store.add(record({ taskId: "other_session", sessionId: "s2" }));
		store.add(record({ taskId: "other_cwd", cwd: "/elsewhere" }));
		assert.match(textOf(await call("stop", "other_session")), /Unknown task_id/);
		assert.match(textOf(await call("steer", "other_cwd", "x")), /Unknown task_id/);
		assert.equal(store.get("other_session")?.status, "running");
	});

	it("refuses a retry on a live leg, and without a saved prompt", async () => {
		store.add(record());
		assert.match(textOf(await call("retry", "task_ctrl_1")), /is running; retry only a failed leg/);
		store.remove("task_ctrl_1");
		store.add(record({ status: "error", prompt: undefined }));
		assert.match(textOf(await call("retry", "task_ctrl_1")), /no saved prompt/);
	});
});
