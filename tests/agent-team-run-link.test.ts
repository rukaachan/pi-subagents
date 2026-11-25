import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	beginAgentTeamSession,
	createTask,
	getTask,
	linkRun,
	updateTask,
} from "../src/app/agent-team/board/index.ts";
import { MAX_AGENT_TEAM_RESULT } from "../src/domain/agent-team/index.ts";
import { decodeAgentTeam } from "../src/infra/state/index.ts";

const lead = { name: "lead", lead: true };
const worker = { name: "worker", lead: false };

function oneTask(): { taskId: string; revision: number } {
	const created = createTask({ subject: "prove the board", description: "" });
	if (!created.ok) assert.fail(created.error);
	return { taskId: created.task.id, revision: created.task.revision };
}

function claim(taskId: string, revision: number): number {
	const result = updateTask({ taskId, expectedRevision: revision, action: "claim" }, worker);
	if (!result.ok) assert.fail(result.error);
	return result.task.revision;
}

function complete(taskId: string, revision: number, result?: string) {
	return updateTask(
		{ taskId, expectedRevision: revision, action: "complete", ...(result ? { result } : {}) },
		worker,
	);
}

beforeEach(() => {
	beginAgentTeamSession("s-link");
});

describe("a task carries its run", () => {
	it("links without moving the revision the leg was handed", () => {
		const { taskId } = oneTask();
		linkRun(taskId, "run-abc");
		assert.equal(getTask(taskId)?.task.revision, 1);
		assert.equal(getTask(taskId)?.task.runId, "run-abc");
		assert.equal(claim(taskId, 1), 2, "the launch revision still claims");
	});

	it("ignores an unknown or deleted task", () => {
		const { taskId, revision } = oneTask();
		linkRun("task-999", "run-abc");
		assert.equal(getTask(taskId)?.task.runId, undefined);
		updateTask({ taskId, expectedRevision: revision, action: "delete" }, lead);
		linkRun(taskId, "run-abc");
		assert.equal(getTask(taskId), undefined);
	});

	it("keeps a blank run id off the board", () => {
		const { taskId } = oneTask();
		linkRun(taskId, "   ");
		assert.equal(getTask(taskId)?.task.runId, undefined);
	});
});

describe("complete keeps what the leg returned", () => {
	it("stores a trimmed result", () => {
		const { taskId } = oneTask();
		const rev = claim(taskId, 1);
		const done = complete(taskId, rev, "  changed src/a.ts; tests pass  ");
		assert.ok(done.ok);
		assert.equal(getTask(taskId)?.task.result, "changed src/a.ts; tests pass");
	});

	it("caps a long result instead of rejecting it", () => {
		const { taskId } = oneTask();
		const rev = claim(taskId, 1);
		assert.ok(complete(taskId, rev, "x".repeat(MAX_AGENT_TEAM_RESULT + 500)).ok);
		assert.equal(getTask(taskId)?.task.result?.length, MAX_AGENT_TEAM_RESULT);
	});

	it("refuses an empty result only when the caller sent one", () => {
		const first = oneTask();
		const rev = claim(first.taskId, first.revision);
		const empty = complete(first.taskId, rev, "   ");
		assert.equal(empty.ok, false);
		if (!empty.ok) assert.match(empty.error, /cannot be empty/);
		assert.equal(getTask(first.taskId)?.task.status, "in_progress", "the board did not move");
	});

	it("leaves the result absent when complete sends none", () => {
		const { taskId } = oneTask();
		const rev = claim(taskId, 1);
		assert.ok(complete(taskId, rev).ok);
		assert.equal(getTask(taskId)?.task.result, undefined);
		assert.equal(getTask(taskId)?.task.status, "completed");
	});
});

describe("state keeps run and result", () => {
	it("round-trips both fields", () => {
		const parsed = decodeAgentTeam({
			agentTeamId: "s-link",
			enabled: true,
			nextId: 2,
			members: [],
			tasks: [
				{
					id: "task-1",
					revision: 3,
					subject: "one",
					description: "",
					status: "completed",
					blockedBy: [],
					writeScopes: [],
					createdAt: 1,
					updatedAt: 2,
					runId: "run-abc",
					result: "done",
				},
			],
		});
		assert.equal(parsed?.tasks[0]?.runId, "run-abc");
		assert.equal(parsed?.tasks[0]?.result, "done");
	});

	it("caps a stored result and drops a non-string", () => {
		const parsed = decodeAgentTeam({
			agentTeamId: "s-link",
			enabled: true,
			nextId: 2,
			members: [],
			tasks: [
				{
					id: "task-1",
					revision: 1,
					subject: "one",
					description: "",
					status: "pending",
					blockedBy: [],
					writeScopes: [],
					createdAt: 1,
					updatedAt: 2,
					runId: 7,
					result: "y".repeat(MAX_AGENT_TEAM_RESULT + 10),
				},
			],
		});
		assert.equal(parsed?.tasks[0]?.runId, undefined);
		assert.equal(parsed?.tasks[0]?.result?.length, MAX_AGENT_TEAM_RESULT);
	});

	it("decodes an old row that has neither field", () => {
		const parsed = decodeAgentTeam({
			agentTeamId: "s-link",
			enabled: false,
			nextId: 2,
			members: [],
			tasks: [
				{
					id: "task-1",
					revision: 1,
					subject: "one",
					description: "",
					status: "pending",
					blockedBy: [],
					writeScopes: [],
					createdAt: 1,
					updatedAt: 2,
				},
			],
		});
		assert.equal(parsed?.tasks[0]?.runId, undefined);
		assert.equal(parsed?.tasks[0]?.result, undefined);
	});
});
