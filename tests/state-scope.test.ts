/**
 * State files are per project, and legacy row clocks are frozen.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultStatePath, sessionStatePath } from "../src/infra/state-file.ts";
import { TaskStore } from "../src/domain/task/index.ts";
import { lastMessageAt } from "../src/domain/task/index.ts";
import { rec } from "./board-fixtures.ts";

describe("project state", () => {
	it("gives every project its own state file", () => {
		const one = defaultStatePath("/tmp/agent", "/repo/one");
		const two = defaultStatePath("/tmp/agent", "/repo/two");
		assert.match(one, /pi-subagents-state\/[a-f0-9]+\.json$/);
		assert.notEqual(one, two);
	});

	it("gives every session its own file inside the same project", () => {
		const one = sessionStatePath("/tmp/agent", "/repo/one", "s1");
		const two = sessionStatePath("/tmp/agent", "/repo/one", "s2");
		const project = defaultStatePath("/tmp/agent", "/repo/one");
		assert.match(one, /pi-subagents-state\/s-[a-f0-9]+\.json$/);
		assert.notEqual(one, two);
		assert.notEqual(one, project);
	});

	it("keeps the legacy global path when no cwd is given", () => {
		assert.match(defaultStatePath("/tmp/agent"), /pi-subagents-state\.json$/);
	});

	it("finds the last timestamp in a saved transcript", () => {
		assert.equal(lastMessageAt([{ timestamp: 1 }, {}, { timestamp: 9 }]), 9);
		assert.equal(lastMessageAt([]), undefined);
	});

	it("freezes a legacy settled row that has no endedAt", () => {
		const store = new TaskStore();
		const finished = rec({
			taskId: "finished",
			status: "done",
			createdAt: 1_000,
			history: [{ timestamp: 5_000 }],
		});
		const failed = rec({ taskId: "failed", status: "error", createdAt: 2_000 });
		store.restore([finished, failed]);
		assert.equal(store.get(finished.taskId)?.endedAt, 5_000);
		assert.equal(store.get(failed.taskId)?.endedAt, 2_000);
	});

	it("freezes an interrupted row at its last transcript line", () => {
		const store = new TaskStore();
		const live = rec({
			taskId: "live",
			status: "running",
			createdAt: 1_000,
			startedAt: 2_000,
			history: [{ timestamp: 7_000 }],
		});
		store.restore([live]);
		assert.equal(store.get(live.taskId)?.status, "error");
		assert.equal(store.get(live.taskId)?.endedAt, 7_000);
	});
});
