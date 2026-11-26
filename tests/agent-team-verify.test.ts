import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	MAX_AGENT_TEAM_ACCEPTANCE,
	newAgentTeam,
	type AgentTeamCaller,
	type AgentTeamMember,
	type AgentTeamTask,
} from "../src/domain/agent-team/index.ts";
import { createAgentTeamTask, updateAgentTeamTask } from "../src/domain/team-tasks/index.ts";

const lead: AgentTeamCaller = { name: "lead", lead: true };
const alice: AgentTeamCaller = { name: "alice", lead: false, role: "worker" };
const verifier: AgentTeamCaller = { name: "verifier", lead: false, role: "verifier" };
const members: AgentTeamMember[] = [
	{ name: "alice", starter: "worker", role: "worker", joinedAt: 1 },
	{ name: "verifier", starter: "code-reviewer", role: "verifier", joinedAt: 2 },
];

function setup(acceptance?: string): AgentTeamTask {
	const board = newAgentTeam("s-1");
	const created = createAgentTeamTask(
		board,
		{ subject: "one", description: "", acceptance, origin: "task", round: 2 },
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

describe("agent team verification", () => {
	it("completes directly when there is no acceptance text", () => {
		const board = newAgentTeam("s-1");
		const created = createAgentTeamTask(board, { subject: "one", description: "" }, 10);
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
			{ taskId: created.task.id, expectedRevision: 2, action: "complete" },
			alice,
			members,
			30,
		);
		assert.ok(done.ok);
		assert.equal(done.task.status, "completed");
	});

	it("moves a gated task to in_review", () => {
		const task = setup("npm test passes");
		assert.equal(task.acceptance, "npm test passes");
		assert.equal(task.origin, "task");
	});

	it("only a verifier or a lead override may verify", () => {
		const task = setup("acceptance");
		const board = newAgentTeam("s-1");
		board.tasks.push(task);
		const denied = updateAgentTeamTask(
			board,
			{ taskId: task.id, expectedRevision: task.revision, action: "verify", verdict: "pass" },
			alice,
			members,
			40,
		);
		assert.equal(denied.ok, false);
		if (!denied.ok) assert.match(denied.error, /verifier or the lead/);
	});

	it("passes review and records the verdict", () => {
		const task = setup("acceptance");
		const board = newAgentTeam("s-1");
		board.tasks.push(task);
		const result = updateAgentTeamTask(
			board,
			{
				taskId: task.id,
				expectedRevision: task.revision,
				action: "verify",
				verdict: "pass",
				note: "checked",
			},
			verifier,
			members,
			40,
		);
		assert.ok(result.ok);
		assert.equal(result.task.status, "completed");
		assert.equal(result.task.verdict, "pass");
		assert.equal(result.task.verifiedBy, "verifier");
		assert.equal(result.task.verifiedAt, 40);
		assert.equal(result.task.attempts?.[0]?.outcome, "passed");
		assert.equal(result.task.attempts?.[0]?.owner, "alice");
		assert.equal(result.task.attempts?.[0]?.method, "checked");
		assert.equal(result.task.attempts?.[0]?.round, 2);
	});

	it("fails review back to pending with the note", () => {
		const task = setup("acceptance");
		const board = newAgentTeam("s-1");
		board.tasks.push(task);
		const result = updateAgentTeamTask(
			board,
			{
				taskId: task.id,
				expectedRevision: task.revision,
				action: "verify",
				verdict: "fail",
				note: "test still red",
			},
			verifier,
			members,
			40,
		);
		assert.ok(result.ok);
		assert.equal(result.task.status, "pending");
		assert.equal(result.task.owner, undefined);
		assert.equal(result.task.lastOwner, "alice");
		assert.equal(result.task.lastError, "test still red");
		assert.equal(result.task.verdict, "fail");
		assert.equal(result.task.attempts?.[0]?.outcome, "failed");
		assert.equal(result.task.attempts?.[0]?.owner, "alice");
		assert.equal(result.task.attempts?.[0]?.error, "test still red");
		assert.equal(result.task.attempts?.[0]?.method, "test still red");
		assert.equal(result.task.attempts?.[0]?.round, 2);
	});

	it("requires a note for a failed verdict and a lead override", () => {
		const task = setup("acceptance");
		const board = newAgentTeam("s-1");
		board.tasks.push(task);
		const failed = updateAgentTeamTask(
			board,
			{ taskId: task.id, expectedRevision: task.revision, action: "verify", verdict: "fail" },
			verifier,
			members,
			40,
		);
		assert.equal(failed.ok, false);
		const override = updateAgentTeamTask(
			board,
			{
				taskId: task.id,
				expectedRevision: task.revision,
				action: "verify",
				verdict: "pass",
				override: true,
			},
			lead,
			members,
			40,
		);
		assert.equal(override.ok, false);
	});

	it("lets the lead override with a reason", () => {
		const task = setup("acceptance");
		const board = newAgentTeam("s-1");
		board.tasks.push(task);
		const result = updateAgentTeamTask(
			board,
			{
				taskId: task.id,
				expectedRevision: task.revision,
				action: "verify",
				verdict: "pass",
				override: true,
				note: "accepting the partial fix",
			},
			lead,
			members,
			40,
		);
		assert.ok(result.ok);
		assert.equal(result.task.status, "completed");
		assert.equal(result.task.verifiedBy, "lead");
	});

	it("reopens an in-review task and clears the verdict", () => {
		const task = setup("acceptance");
		const board = newAgentTeam("s-1");
		board.tasks.push(task);
		const result = updateAgentTeamTask(
			board,
			{ taskId: task.id, expectedRevision: task.revision, action: "reopen" },
			lead,
			members,
			40,
		);
		assert.ok(result.ok);
		assert.equal(result.task.status, "pending");
		assert.equal(result.task.verdict, undefined);
	});

	it("validates acceptance and verifyWith", () => {
		const board = newAgentTeam("s-1");
		const tooLong = createAgentTeamTask(
			board,
			{ subject: "one", description: "", acceptance: "x".repeat(MAX_AGENT_TEAM_ACCEPTANCE + 1) },
			10,
		);
		assert.equal(tooLong.ok, false);
		const badName = createAgentTeamTask(
			board,
			{ subject: "one", description: "", verifyWith: "Bad Name" },
			10,
		);
		assert.equal(badName.ok, false);
	});
});
