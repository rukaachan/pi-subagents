import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	liveTasks,
	newAgentTeam,
	normalizeScopes,
	agentTeamView,
	type AgentTeamBoard,
	type AgentTeamMember,
} from "../src/domain/agent-team/index.ts";
import { updateAgentTeamTask } from "../src/domain/team-tasks/index.ts";
import { createAgentTeamTask } from "../src/domain/team-tasks/index.ts";

const lead = { name: "lead", lead: true };
const alice = { name: "alice", lead: false };
const bob = { name: "bob", lead: false };
const members: AgentTeamMember[] = [
	{ name: "alice", starter: "worker", role: "worker", joinedAt: 1 },
	{ name: "bob", starter: "worker", role: "worker", joinedAt: 2 },
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
	who = lead,
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

describe("team board: create", () => {
	it("makes an unowned, ready, revision-one task", () => {
		const b = newBoard();
		const task = add(b, "  Fix parser  ");
		assert.equal(task.id, "task-1");
		assert.equal(task.revision, 1);
		assert.equal(task.status, "pending");
		assert.equal(task.subject, "Fix parser");
		assert.equal(task.owner, undefined);
		const view = agentTeamView(task, b);
		assert.equal(view.ready, true);
		assert.deepEqual(view.blockedByOpen, []);
	});

	it("rejects an empty or oversized subject", () => {
		const b = newBoard();
		assert.equal(createAgentTeamTask(b, { subject: "   ", description: "" }).ok, false);
		assert.equal(createAgentTeamTask(b, { subject: "x".repeat(121), description: "" }).ok, false);
	});

	it("normalizes write scopes and rejects escapes", () => {
		const b = newBoard();
		const task = add(b, "work", { writeScopes: ["./src/app/", "src/app//x", "src/./app"] });
		assert.deepEqual(task.writeScopes, ["src/app", "src/app/x"]);
		assert.deepEqual(normalizeScopes(["src/./app"]), { ok: true, scopes: ["src/app"] });
		assert.equal(normalizeScopes(["/etc/passwd"]).ok, false);
		const parent = normalizeScopes(["../x"]);
		assert.equal(parent.ok, false);
		if (!parent.ok) assert.match(parent.error, /cannot contain "\.\."/);
		assert.equal(normalizeScopes([""]).ok, false);
	});

	it("requires blockers to exist", () => {
		const b = newBoard();
		assert.equal(
			createAgentTeamTask(b, { subject: "x", description: "", blockedBy: ["task-9"] }).ok,
			false,
		);
	});
});

describe("team board: claim and complete", () => {
	it("claims a ready task and refuses a second claim", () => {
		const b = newBoard();
		add(b, "one");
		const first = run(b, "task-1", "claim", {}, alice);
		assert.equal(first.ok, true);
		const second = run(b, "task-1", "claim", {}, bob);
		assert.equal(second.ok, false);
		assert.match(second.ok ? "" : second.error, /owned by alice/);
	});

	it("lets the owner claim again without bumping", () => {
		const b = newBoard();
		add(b, "one");
		assert.equal(run(b, "task-1", "claim", {}, alice).ok, true);
		const again = run(b, "task-1", "claim", {}, alice);
		assert.equal(again.ok, true);
		assert.equal(again.ok ? again.task.revision : 0, 2);
	});

	it("refuses a blocked task until its blocker completes", () => {
		const b = newBoard();
		add(b, "one");
		const two = add(b, "two", { blockedBy: ["task-1"] });
		assert.equal(two.blockedBy[0], "task-1");
		const early = run(b, "task-2", "claim", {}, bob);
		assert.equal(early.ok, false);
		assert.match(early.ok ? "" : early.error, /blocked by task-1/);
		assert.equal(run(b, "task-1", "claim", {}, alice).ok, true);
		assert.equal(run(b, "task-1", "complete", {}, alice).ok, true);
		assert.equal(run(b, "task-2", "claim", {}, bob).ok, true);
	});

	it("rejects a stale revision", () => {
		const b = newBoard();
		add(b, "one");
		const task = b.tasks[0];
		assert.ok(task);
		const stale = updateAgentTeamTask(
			b,
			{ taskId: "task-1", expectedRevision: 99, action: "claim" },
			alice,
			members,
		);
		assert.equal(stale.ok, false);
		assert.match(stale.ok ? "" : stale.error, /revision 1, expected 99/);
	});

	it("lets the lead complete an unowned task, but not another member", () => {
		const b = newBoard();
		add(b, "one");
		const denied = run(b, "task-1", "complete", {}, alice);
		assert.equal(denied.ok, false);
		assert.equal(run(b, "task-1", "complete").ok, true);
	});

	it("reopens a completed task and clears its owner", () => {
		const b = newBoard();
		add(b, "one");
		run(b, "task-1", "claim", {}, alice);
		run(b, "task-1", "complete", {}, alice);
		const reopened = run(b, "task-1", "reopen", {}, alice);
		assert.equal(reopened.ok, true);
		if (reopened.ok) {
			assert.equal(reopened.task.status, "pending");
			assert.equal(reopened.task.owner, undefined);
		}
	});
});

describe("team board: authority and edits", () => {
	it("only the lead reassigns, and only to known members", () => {
		const b = newBoard();
		add(b, "one");
		assert.equal(run(b, "task-1", "reassign", { owner: "alice" }, alice).ok, false);
		const assigned = run(b, "task-1", "reassign", { owner: "alice" });
		assert.equal(assigned.ok, true);
		if (assigned.ok) {
			assert.equal(assigned.task.owner, "alice");
			assert.equal(assigned.task.status, "in_progress");
		}
		assert.match(
			run(b, "task-1", "reassign", { owner: "nobody" }).ok
				? ""
				: (run(b, "task-1", "reassign", { owner: "nobody" }) as { error: string }).error,
			/No member named/,
		);
	});

	it("unassigns on an empty owner", () => {
		const b = newBoard();
		add(b, "one");
		run(b, "task-1", "reassign", { owner: "alice" });
		const cleared = run(b, "task-1", "reassign", {});
		assert.equal(cleared.ok, true);
		if (cleared.ok) assert.equal(cleared.task.status, "pending");
	});

	it("edits subject and scopes, but refuses an empty edit", () => {
		const b = newBoard();
		add(b, "one");
		const edited = run(b, "task-1", "edit", { subject: "two", writeScopes: ["src"] });
		assert.equal(edited.ok, true);
		if (edited.ok) assert.deepEqual(edited.task.writeScopes, ["src"]);
		assert.equal(run(b, "task-1", "edit", {}).ok, false);
	});

	it("rejects dependency cycles", () => {
		const b = newBoard();
		add(b, "one");
		add(b, "two");
		assert.equal(run(b, "task-2", "edit", { blockedBy: ["task-1"] }).ok, true);
		const cycle = run(b, "task-1", "edit", { blockedBy: ["task-2"] });
		assert.equal(cycle.ok, false);
		assert.match(cycle.ok ? "" : cycle.error, /cycle/);
		assert.deepEqual(b.tasks[0]?.blockedBy, []);
	});

	it("keeps a deleted task as a tombstone and refuses further edits", () => {
		const b = newBoard();
		add(b, "one");
		assert.equal(run(b, "task-1", "delete").ok, true);
		assert.equal(liveTasks(b).length, 0);
		const again = run(b, "task-1", "complete");
		assert.equal(again.ok, false);
	});
});

describe("team board: delete guards", () => {
	it("refuses to delete a task that still blocks another", () => {
		const b = newBoard();
		add(b, "one");
		add(b, "two", { blockedBy: ["task-1"] });
		const refused = run(b, "task-1", "delete", {});
		assert.equal(refused.ok, false);
		if (!refused.ok) assert.match(refused.error, /still blocks task-2/);
		const cleared = run(b, "task-2", "edit", { blockedBy: [] });
		assert.equal(cleared.ok, true);
		assert.equal(run(b, "task-1", "delete", {}).ok, true);
	});
});

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
