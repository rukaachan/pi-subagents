import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TaskRecord } from "../src/domain/task/index.ts";
import { whyText } from "../src/ui/view/run/index.ts";
import { taskDetail } from "../src/ui/view/run/index.ts";

function rec(over: Partial<TaskRecord> = {}): TaskRecord {
	return {
		taskId: "task-1",
		subagentName: "tester",
		description: "probe",
		status: "error",
		createdAt: 1,
		endedAt: 2,
		fullDelivered: false,
		subagent: {
			name: "tester",
			description: "",
			model: "inherit",
			autonomy: "low",
			systemPrompt: "",
			source: "user",
			filePath: "x",
			warnings: [],
		},
		cwd: "/tmp",
		history: [
			{
				role: "assistant",
				content: [
					{ type: "toolCall", name: "read" },
					{ type: "toolCall", name: "bash" },
				],
			},
			{ role: "assistant", content: [{ type: "toolCall", name: "grep" }] },
		],
		error: "tests failed",
		...over,
	};
}

describe("why text", () => {
	it("names status, failure, turns, tokens, tools, and the last error", () => {
		const text = whyText(
			rec({
				failure: "spec",
				result: {
					text: "the report body",
					usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 3 },
					model: "acme/fast",
					notes: [],
				},
			}),
		);
		assert.match(text, /why: error/);
		assert.match(text, /failure: spec/);
		assert.match(text, /turns: 3 · tokens: 120/);
		assert.match(text, /tools: read, bash, grep/);
		assert.match(text, /last error: tests failed/);
		assert.match(text, /report: the report body/);
	});

	it("names the failing chain step", () => {
		const text = whyText(
			rec({
				kind: "chain",
				steps: [
					{ idx: 0, subagentName: "planner", prompt: "p", status: "done" },
					{ idx: 1, subagentName: "tester", prompt: "t", status: "error", error: "boom" },
				],
			}),
		);
		assert.match(text, /step: 2 tester/);
	});

	it("is appended to the task detail notice for a failed run", () => {
		const detail = taskDetail(rec());
		assert.match(detail, /─── why ───/);
		assert.match(detail, /why: error/);
	});
});
