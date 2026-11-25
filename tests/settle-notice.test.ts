import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { announceSettle } from "../src/app/live/index.ts";
import { clearNotifySink, setNotifySink } from "../src/telemetry/notify/index.ts";
import {
	beginAgentTeamSession,
	createTask,
	enableAgentTeam,
	joinAgentTeam,
	taskList,
	updateTask,
} from "../src/app/agent-team/board/index.ts";
import type { TaskRecord } from "../src/domain/task/index.ts";

function record(over: Partial<TaskRecord> = {}): TaskRecord {
	return {
		taskId: "task_1",
		subagentName: "explorer",
		description: "map the auth module",
		status: "done",
		createdAt: Date.now() - 42_000,
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
		history: [],
		result: {
			text: "REPORT_BODY",
			usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 2 },
			notes: [],
		},
		...over,
	};
}

function claim(): void {
	beginAgentTeamSession("s1");
	enableAgentTeam();
	joinAgentTeam("worker", "run-a");
	createTask({ subject: "one", description: "" });
	updateTask(
		{ taskId: "task-1", expectedRevision: 1, action: "claim" },
		{ name: "worker", lead: false },
	);
}

describe("announceSettle", () => {
	beforeEach(() => clearNotifySink());

	it("releases a failed run's task and says so", () => {
		claim();
		let content = "";
		setNotifySink((m) => {
			content = m.content;
		});
		announceSettle(record({ taskId: "run-a", status: "error", error: "boom" }), "s1");
		assert.match(content, /Released task-1/);
		assert.equal(taskList()[0]?.task.status, "pending");
	});

	it("flags a task a done run forgot to close", () => {
		claim();
		let content = "";
		setNotifySink((m) => {
			content = m.content;
		});
		announceSettle(record({ taskId: "run-a" }), "s1");
		assert.match(content, /Left task-1 in_progress/);
		assert.equal(taskList()[0]?.task.status, "in_progress");
	});

	it("sends the report once and marks it delivered", () => {
		let content = "";
		setNotifySink((m) => {
			content = m.content;
		});
		const rec = record();
		assert.equal(announceSettle(rec, "s1"), true);
		assert.equal(rec.fullDelivered, true);
		assert.match(content, /REPORT_BODY/);
		assert.match(content, /2 turns · 120 tok/);
	});

	it("does not repeat the body on a second call", () => {
		const seen: string[] = [];
		setNotifySink((m) => {
			seen.push(m.content);
		});
		const rec = record();
		announceSettle(rec, "s1");
		announceSettle(rec, "s1");
		assert.equal(seen.length, 2);
		assert.match(seen[0] ?? "", /REPORT_BODY/);
		assert.doesNotMatch(seen[1] ?? "", /REPORT_BODY/);
		assert.match(seen[1] ?? "", /already delivered/);
	});

	it("honors a report TaskOutput already delivered", () => {
		let content = "";
		setNotifySink((m) => {
			content = m.content;
		});
		const rec = record({ fullDelivered: true });
		assert.equal(announceSettle(rec, "s1"), true);
		assert.doesNotMatch(content, /REPORT_BODY/);
		assert.match(content, /already delivered/);
	});

	it("leaves the flag alone when the sink fails", () => {
		setNotifySink(() => {
			throw new Error("no ui");
		});
		const rec = record();
		assert.equal(announceSettle(rec, "s1"), false);
		assert.equal(rec.fullDelivered, false);
	});

	it("reports an error without a body", () => {
		let content = "";
		setNotifySink((m) => {
			content = m.content;
		});
		const rec = record({ status: "error", result: undefined, error: "429 too many requests" });
		assert.equal(announceSettle(rec, "s1"), true);
		assert.match(content, /ERROR/);
		assert.match(content, /429 too many requests/);
		assert.doesNotMatch(content, /REPORT_BODY/);
		assert.equal(rec.fullDelivered, false);
	});
});
