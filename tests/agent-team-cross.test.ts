import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	agentTeamGate,
	newAgentTeam,
	type AgentTeamCaller,
	type AgentTeamMember,
	type AgentTeamTask,
} from "../src/domain/agent-team/index.ts";
import { createAgentTeamTask, updateAgentTeamTask } from "../src/domain/team-tasks/index.ts";
import { crossPrompt } from "../src/app/agent-team/cross-run/index.ts";

const lead: AgentTeamCaller = { name: "lead", lead: true };
const alice: AgentTeamCaller = { name: "alice", lead: false, role: "worker" };
const verifier: AgentTeamCaller = { name: "verifier", lead: false, role: "verifier" };
const members: AgentTeamMember[] = [
	{ name: "alice", starter: "worker", role: "worker", joinedAt: 1 },
	{ name: "verifier", starter: "code-reviewer", role: "verifier", joinedAt: 2 },
];

function setup(over: { crossVerify?: boolean; acceptance?: string } = {}): AgentTeamTask {
	const board = newAgentTeam("s-cross");
	const created = createAgentTeamTask(
		board,
		{
			subject: "one",
			description: "",
			acceptance: over.acceptance ?? "tests pass",
			crossVerify: over.crossVerify ?? true,
			round: 2,
			origin: "task",
		},
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
	return done.task;
}

function verify(
	task: AgentTeamTask,
	over: { scope?: "task" | "cross"; verdict?: "pass" | "fail"; note?: string } = {},
) {
	const board = newAgentTeam("s-cross");
	board.tasks.push(task);
	return updateAgentTeamTask(
		board,
		{
			taskId: task.id,
			expectedRevision: task.revision,
			action: "verify",
			verdict: over.verdict ?? "pass",
			...(over.scope ? { scope: over.scope } : {}),
			...(over.note ? { note: over.note } : {}),
		},
		verifier,
		members,
		40,
	);
}

describe("cross verification", () => {
	it("needs acceptance to opt in", () => {
		const board = newAgentTeam("s-cross");
		const created = createAgentTeamTask(
			board,
			{ subject: "one", description: "", crossVerify: true },
			10,
		);
		assert.equal(created.ok, false);
		if (!created.ok) assert.match(created.error, /needs acceptance/);
	});

	it("keeps a passed task in review until the second reader passes", () => {
		const task = setup();
		const first = verify(task);
		assert.ok(first.ok);
		assert.equal(first.task.status, "in_review");
		assert.equal(first.task.verdict, "pass");
		assert.equal(first.task.crossVerdict, undefined);
		assert.equal(agentTeamGate(first.task), "cross");
		assert.equal(first.task.attempts?.at(-1)?.outcome, "passed");
	});

	it("completes only after both readers pass", () => {
		const first = verify(setup());
		assert.ok(first.ok);
		const second = verify(first.task, { scope: "cross" });
		assert.ok(second.ok);
		assert.equal(second.task.status, "completed");
		assert.equal(second.task.crossVerdict, "pass");
		assert.equal(second.task.crossVerifiedBy, "verifier");
		assert.equal(agentTeamGate(second.task), "done");
	});

	it("returns a failed cross review to pending with both verdicts kept", () => {
		const first = verify(setup());
		assert.ok(first.ok);
		const second = verify(first.task, { scope: "cross", verdict: "fail", note: "edge case fails" });
		assert.ok(second.ok);
		assert.equal(second.task.status, "pending");
		assert.equal(second.task.verdict, "pass");
		assert.equal(second.task.crossVerdict, "fail");
		assert.equal(second.task.lastError, "edge case fails");
		assert.equal(second.task.owner, undefined);
		assert.equal(agentTeamGate(second.task), "cross");
	});

	it("refuses a cross review before the first reader passes", () => {
		const task = setup();
		const early = verify(task, { scope: "cross" });
		assert.equal(early.ok, false);
		if (!early.ok) assert.match(early.error, /task verifier to pass first/);
	});

	it("refuses cross review on a task that did not opt in", () => {
		const first = verify(setup());
		assert.ok(first.ok);
		first.task.crossVerify = false;
		const second = verify(first.task, { scope: "cross" });
		assert.equal(second.ok, false);
		if (!second.ok) assert.match(second.error, /not opted in/);
	});

	it("clears cross verdicts when the opt-in is removed", () => {
		const first = verify(setup());
		assert.ok(first.ok);
		const second = verify(first.task, { scope: "cross" });
		assert.ok(second.ok);
		const board = newAgentTeam("s-cross");
		board.tasks.push(second.task);
		const edited = updateAgentTeamTask(
			board,
			{
				taskId: second.task.id,
				expectedRevision: second.task.revision,
				action: "edit",
				crossVerify: false,
			},
			lead,
			members,
			50,
		);
		assert.ok(edited.ok);
		assert.equal(edited.task.crossVerify, undefined);
		assert.equal(edited.task.crossVerdict, undefined);
	});

	it("caps the cross prompt rows and text", () => {
		const board = newAgentTeam("s-cross");
		for (let i = 0; i < 12; i += 1) {
			board.tasks.push({
				id: `task-${i}`,
				revision: 1,
				subject: "x".repeat(200),
				description: "",
				status: "in_review",
				blockedBy: [],
				writeScopes: [],
				acceptance: "a".repeat(600),
				result: "r".repeat(600),
				round: 2,
				createdAt: 1,
				updatedAt: 1,
			});
		}
		const first = board.tasks[0];
		if (!first) throw new Error("missing first task");
		const prompt = crossPrompt("task-0", first, board);
		const rows = prompt.split("\n").filter((line) => line.startsWith("- task-"));
		assert.equal(rows.length, 8);
		assert.ok(rows.every((line) => line.length < 1_200));
		assert.match(prompt, /scope: "cross"/);
	});
});
