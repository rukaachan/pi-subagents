import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { beginTeamSession, createTask, linkRun } from "../src/app/team-store.ts";
import { linkedRun } from "../src/app/team-run.ts";
import { TaskStore } from "../src/domain/task/index.ts";
import { rec } from "./board-fixtures.ts";

function board(): { taskId: string } {
	const created = createTask({ subject: "prove the board", description: "" });
	if (!created.ok) assert.fail(created.error);
	return { taskId: created.task.id };
}

beforeEach(() => {
	beginTeamSession("s-run");
});

describe("a board row opens its run", () => {
	it("resolves a linked run that the store still holds", () => {
		const { taskId } = board();
		const store = new TaskStore();
		store.add(rec({ taskId: "task-run-0" }));
		linkRun(taskId, "task-run-0");
		const linked = linkedRun(store, taskId);
		assert.equal(linked.ok, true);
		if (linked.ok) assert.equal(linked.rec.taskId, "task-run-0");
	});

	it("says when a task has no run linked", () => {
		const { taskId } = board();
		const linked = linkedRun(new TaskStore(), taskId);
		assert.equal(linked.ok, false);
		if (!linked.ok) assert.match(linked.error, /has no run linked/);
	});

	it("says when the linked run left the store", () => {
		const { taskId } = board();
		linkRun(taskId, "task-gone-1");
		const linked = linkedRun(new TaskStore(), taskId);
		assert.equal(linked.ok, false);
		if (!linked.ok) assert.match(linked.error, /task-gone-1 is not in this session/);
	});
});
