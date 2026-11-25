import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	beginAgentTeamSession,
	createTask,
	enableAgentTeam,
	joinAgentTeam,
	taskList,
	updateTask,
} from "../src/app/agent-team/board/index.ts";
import { releaseOrphanedTasks, sweepMemberTasks } from "../src/app/agent-team/board/index.ts";

function claimed(): void {
	enableAgentTeam();
	joinAgentTeam("worker", "run-a");
	createTask({ subject: "one", description: "" });
	updateTask(
		{ taskId: "task-1", expectedRevision: 1, action: "claim" },
		{ name: "worker", lead: false },
	);
}

beforeEach(() => {
	beginAgentTeamSession("s-team");
});

describe("run sweep", () => {
	it("releases a failed run's claimed task", () => {
		claimed();
		const sweep = sweepMemberTasks("run-a", false);
		assert.deepEqual(sweep, { released: ["task-1"], open: [] });
		const task = taskList()[0]?.task;
		assert.equal(task?.status, "pending");
		assert.equal(task?.owner, undefined);
		assert.equal(task?.revision, 3);
	});

	it("reports what a successful run left claimed", () => {
		claimed();
		assert.deepEqual(sweepMemberTasks("run-a", true), { released: [], open: ["task-1"] });
		assert.equal(taskList()[0]?.task.status, "in_progress");
	});

	it("records who failed and why", () => {
		claimed();
		sweepMemberTasks("run-a", false, 99, "boom");
		const task = taskList()[0]?.task;
		assert.equal(task?.lastOwner, "worker");
		assert.equal(task?.lastError, "boom");
		assert.equal(task?.returnedAt, 99);
		assert.equal(task?.attempts?.at(-1)?.outcome, "released");
		assert.equal(task?.attempts?.at(-1)?.owner, "worker");
		assert.equal(task?.attempts?.at(-1)?.error, "boom");
	});

	it("releases every claimed task after a restart", () => {
		claimed();
		assert.deepEqual(releaseOrphanedTasks(99), ["task-1"]);
		const task = taskList()[0]?.task;
		assert.equal(task?.status, "pending");
		assert.equal(task?.lastOwner, "worker");
		assert.equal(task?.lastError, "Pi restarted");
		assert.equal(task?.attempts?.at(-1)?.outcome, "released");
	});

	it("ignores a key that never joined", () => {
		claimed();
		assert.deepEqual(sweepMemberTasks("run-x", false), { released: [], open: [] });
		assert.equal(taskList()[0]?.task.status, "in_progress");
	});
});
