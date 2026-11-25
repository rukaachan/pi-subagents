import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	MAX_AGENT_TEAM_FACT,
	newAgentTeam,
	type AgentTeamCaller,
	type AgentTeamMember,
	type AgentTeamTask,
} from "../src/domain/agent-team/index.ts";
import { createAgentTeamTask, updateAgentTeamTask } from "../src/domain/team-tasks/index.ts";

const alice: AgentTeamCaller = { name: "alice", lead: false, role: "worker" };
const verifier: AgentTeamCaller = { name: "verifier", lead: false, role: "verifier" };
const members: AgentTeamMember[] = [
	{ name: "alice", starter: "worker", role: "worker", joinedAt: 1 },
	{ name: "verifier", starter: "code-reviewer", role: "verifier", joinedAt: 2 },
];

function inReview(acceptance: string): AgentTeamTask {
	const board = newAgentTeam("s-ledger");
	const created = createAgentTeamTask(
		board,
		{ subject: "one", description: "", acceptance, origin: "task" },
		10,
	);
	assert.ok(created.ok);
	const claimed = updateAgentTeamTask(
		board,
		{ taskId: created.task.id, expectedRevision: 1, action: "claim" },
		alice,
		members,
		20,
	);
	assert.ok(claimed.ok);
	const done = updateAgentTeamTask(
		board,
		{
			taskId: claimed.task.id,
			expectedRevision: claimed.task.revision,
			action: "complete",
			result: "done",
		},
		alice,
		members,
		30,
	);
	assert.ok(done.ok);
	assert.equal(done.task.status, "in_review");
	return done.task;
}

describe("agent team verification ledger", () => {
	it("keeps a checked fact on pass and a dead end on fail", () => {
		const task = inReview("acceptance");
		const board = newAgentTeam("s-1");
		board.tasks.push(task);
		const passed = updateAgentTeamTask(
			board,
			{
				taskId: task.id,
				expectedRevision: task.revision,
				action: "verify",
				verdict: "pass",
				note: "checked",
				fact: "Parser handles CRLF",
			},
			verifier,
			members,
			40,
		);
		assert.ok(passed.ok);
		assert.deepEqual(
			board.ledger.map((entry) => [entry.kind, entry.text, entry.taskId, entry.by]),
			[["fact", "Parser handles CRLF", "task-1", "verifier"]],
		);

		const failedTask = inReview("acceptance");
		const failBoard = newAgentTeam("s-2");
		failBoard.tasks.push(failedTask);
		const failed = updateAgentTeamTask(
			failBoard,
			{
				taskId: failedTask.id,
				expectedRevision: failedTask.revision,
				action: "verify",
				verdict: "fail",
				note: "no CRLF test",
				excluded: "No CRLF fixture exists",
			},
			verifier,
			members,
			50,
		);
		assert.ok(failed.ok);
		assert.equal(failBoard.ledger[0]?.kind, "excluded");
		assert.equal(failBoard.ledger[0]?.text, "No CRLF fixture exists");
		assert.equal(failed.task.attempts?.[0]?.outcome, "failed");
	});

	it("rejects a fact on fail, both notes, and an overlong fact", () => {
		const task = inReview("acceptance");
		const board = newAgentTeam("s-1");
		board.tasks.push(task);
		const wrongVerdict = updateAgentTeamTask(
			board,
			{
				taskId: task.id,
				expectedRevision: task.revision,
				action: "verify",
				verdict: "fail",
				note: "red",
				fact: "misplaced",
			},
			verifier,
			members,
			40,
		);
		assert.equal(wrongVerdict.ok, false);
		if (!wrongVerdict.ok) assert.match(wrongVerdict.error, /passing verdict/);
		const both = updateAgentTeamTask(
			board,
			{
				taskId: task.id,
				expectedRevision: task.revision,
				action: "verify",
				verdict: "pass",
				fact: "one",
				excluded: "two",
			},
			verifier,
			members,
			40,
		);
		assert.equal(both.ok, false);
		const longFact = updateAgentTeamTask(
			board,
			{
				taskId: task.id,
				expectedRevision: task.revision,
				action: "verify",
				verdict: "pass",
				fact: "x".repeat(MAX_AGENT_TEAM_FACT + 1),
			},
			verifier,
			members,
			40,
		);
		assert.equal(longFact.ok, false);
		assert.equal(board.tasks[0]?.status, "in_review");
		assert.equal(board.ledger.length, 0);
	});
});
