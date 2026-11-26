import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	agentTeamView,
	newAgentTeam,
	type AgentTeamBoard,
	type AgentTeamMember,
} from "../src/domain/agent-team/index.ts";
import { createAgentTeamTask, updateAgentTeamTask } from "../src/domain/team-tasks/index.ts";

const alice = { name: "alice", lead: false };
const members: AgentTeamMember[] = [
	{ name: "alice", starter: "worker", role: "worker", joinedAt: 1 },
];

function newBoard(): AgentTeamBoard {
	return newAgentTeam("s-1");
}

function add(
	board: AgentTeamBoard,
	subject: string,
	extra: { blockedBy?: string[]; writeScopes?: string[] } = {},
) {
	const result = createAgentTeamTask(board, { subject, description: "", ...extra }, 10);
	if (!result.ok) throw new Error(result.error);
	return result.task;
}

function run(
	board: AgentTeamBoard,
	taskId: string,
	action: Parameters<typeof updateAgentTeamTask>[1]["action"],
	extra: Partial<Parameters<typeof updateAgentTeamTask>[1]> = {},
	who = alice,
) {
	const task = board.tasks.find((row) => row.id === taskId);
	assert.ok(task);
	return updateAgentTeamTask(
		board,
		{ taskId, expectedRevision: task.revision, action, ...extra },
		who,
		members,
		20,
	);
}

describe("team board: scope warnings", () => {
	it("warns on overlap only while another task is in progress", () => {
		const b = newBoard();
		add(b, "one", { writeScopes: ["src/app"] });
		const second = add(b, "two", { writeScopes: ["src/app/file.ts"] });
		assert.deepEqual(agentTeamView(second, b).writeScopeWarnings, []);
		run(b, "task-1", "claim", {}, alice);
		assert.match(agentTeamView(second, b).writeScopeWarnings.join(" "), /overlaps task-1/);
		run(b, "task-1", "complete", {}, alice);
		assert.deepEqual(agentTeamView(second, b).writeScopeWarnings, []);
	});
});

describe("team board: rounds and cross fields", () => {
	it("starts with no rounds", () => {
		assert.deepEqual(newAgentTeam("s-1").rounds, []);
	});

	it("reopen clears both verdicts but keeps the worktree and round", () => {
		const b = newBoard();
		add(b, "one");
		const task = b.tasks[0];
		assert.ok(task);
		task.acceptance = "checks pass";
		task.round = 2;
		task.crossVerify = true;
		task.isolation = "worktree";
		task.worktree = { path: "/tmp/wt", base: "/repo", createdAt: 3 };
		task.verdict = "pass";
		task.verifiedBy = "verifier";
		task.verifiedAt = 4;
		task.verifyRunId = "run-v";
		task.crossVerdict = "pass";
		task.crossVerifiedBy = "cross";
		task.crossVerifiedAt = 5;
		task.crossVerifyRunId = "run-c";
		assert.equal(run(b, "task-1", "claim", {}, alice).ok, true);
		assert.equal(run(b, "task-1", "complete", {}, alice).ok, true);
		const reopened = run(b, "task-1", "reopen", {}, alice);
		assert.equal(reopened.ok, true);
		assert.equal(task.status, "pending");
		assert.equal(task.verdict, undefined);
		assert.equal(task.verifiedBy, undefined);
		assert.equal(task.verifiedAt, undefined);
		assert.equal(task.verifyRunId, undefined);
		assert.equal(task.crossVerdict, undefined);
		assert.equal(task.crossVerifiedBy, undefined);
		assert.equal(task.crossVerifiedAt, undefined);
		assert.equal(task.crossVerifyRunId, undefined);
		assert.equal(task.round, 2);
		assert.equal(task.crossVerify, true);
		assert.deepEqual(task.worktree, { path: "/tmp/wt", base: "/repo", createdAt: 3 });
	});
});
