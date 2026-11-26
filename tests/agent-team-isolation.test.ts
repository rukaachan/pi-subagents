import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	newAgentTeam,
	type AgentTeamCaller,
	type AgentTeamMember,
} from "../src/domain/agent-team/index.ts";
import { createAgentTeamTask, updateAgentTeamTask } from "../src/domain/team-tasks/index.ts";

const lead: AgentTeamCaller = { name: "lead", lead: true };
const alice: AgentTeamCaller = { name: "alice", lead: false, role: "worker" };
const members: AgentTeamMember[] = [
	{ name: "alice", starter: "worker", role: "worker", joinedAt: 1 },
];

function pending() {
	const board = newAgentTeam("s-iso");
	const created = createAgentTeamTask(
		board,
		{ subject: "one", description: "", isolation: "worktree", origin: "task" },
		10,
	);
	assert.ok(created.ok);
	return { board, task: created.task };
}

describe("task isolation", () => {
	it("stores worktree isolation on create", () => {
		const { task } = pending();
		assert.equal(task.isolation, "worktree");
	});

	it("changes isolation only while pending", () => {
		const { board, task } = pending();
		const shared = updateAgentTeamTask(
			board,
			{ taskId: task.id, expectedRevision: 1, action: "edit", isolation: "shared" },
			lead,
			members,
			20,
		);
		assert.ok(shared.ok);
		assert.equal(shared.task.isolation, undefined);
		const worktree = updateAgentTeamTask(
			board,
			{ taskId: task.id, expectedRevision: 2, action: "edit", isolation: "worktree" },
			lead,
			members,
			21,
		);
		assert.ok(worktree.ok);
		const claimed = updateAgentTeamTask(
			board,
			{ taskId: task.id, expectedRevision: 3, action: "claim" },
			alice,
			members,
			30,
		);
		assert.ok(claimed.ok);
		const late = updateAgentTeamTask(
			board,
			{ taskId: task.id, expectedRevision: 4, action: "edit", isolation: "shared" },
			lead,
			members,
			40,
		);
		assert.equal(late.ok, false);
		if (!late.ok) assert.match(late.error, /only while the task is pending/);
	});

	it("refuses sharing while a worktree is attached", () => {
		const { board, task } = pending();
		task.worktree = { path: "/tmp/wt", base: "abc", createdAt: 1 };
		const shared = updateAgentTeamTask(
			board,
			{ taskId: task.id, expectedRevision: 1, action: "edit", isolation: "shared" },
			lead,
			members,
			20,
		);
		assert.equal(shared.ok, false);
		if (!shared.ok) assert.match(shared.error, /Remove the worktree/);
	});
});
