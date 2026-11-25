import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	createTeamTask,
	newTeam,
	type TeamBoard,
	type TeamMember,
} from "../src/domain/team/index.ts";
import { updateTeamTask } from "../src/domain/team/index.ts";

const lead = { name: "lead", lead: true };
const alice = { name: "alice", lead: false };
const bob = { name: "bob", lead: false };
const members: TeamMember[] = [
	{ name: "alice", starter: "worker", joinedAt: 1 },
	{ name: "bob", starter: "worker", joinedAt: 2 },
];

function add(board: TeamBoard, subject: string, writeScopes: string[] = []) {
	const result = createTeamTask(board, { subject, description: "", writeScopes }, 10);
	if (!result.ok) throw new Error(result.error);
	return result.task;
}

function run(
	board: TeamBoard,
	taskId: string,
	action: Parameters<typeof updateTeamTask>[1]["action"],
	extra: Partial<Parameters<typeof updateTeamTask>[1]> = {},
	who = lead,
) {
	const task = board.tasks.find((row) => row.id === taskId);
	assert.ok(task);
	return updateTeamTask(
		board,
		{ taskId, expectedRevision: task.revision, action, ...extra },
		who,
		members,
		20,
	);
}

describe("team scope reservation", () => {
	it("refuses a claim that overlaps an in-progress scope", () => {
		const b = newTeam("s-1");
		add(b, "one", ["src/app"]);
		add(b, "two", ["src/app/team"]);
		assert.equal(run(b, "task-1", "claim", {}, alice).ok, true);
		const refused = run(b, "task-2", "claim", {}, bob);
		assert.equal(refused.ok, false);
		if (!refused.ok) {
			assert.match(refused.error, /overlaps task-1/);
			assert.match(refused.error, /in progress, alice/);
		}
		assert.equal(run(b, "task-1", "complete", {}, alice).ok, true);
		assert.equal(run(b, "task-2", "claim", {}, bob).ok, true);
	});

	it("normalizes dot segments before comparing", () => {
		const b = newTeam("s-1");
		add(b, "one", ["src/app"]);
		add(b, "two", ["src/./app"]);
		assert.equal(run(b, "task-1", "claim", {}, alice).ok, true);
		assert.equal(run(b, "task-2", "claim", {}, bob).ok, false);
	});

	it("allows disjoint scopes", () => {
		const b = newTeam("s-1");
		add(b, "one", ["src/app"]);
		add(b, "two", ["src/ui"]);
		assert.equal(run(b, "task-1", "claim", {}, alice).ok, true);
		assert.equal(run(b, "task-2", "claim", {}, bob).ok, true);
	});

	it("locks nothing for a pending or completed task", () => {
		const b = newTeam("s-1");
		add(b, "one", ["src/app"]);
		add(b, "two", ["src/app/x"]);
		assert.equal(run(b, "task-2", "claim", {}, bob).ok, true);
		assert.equal(run(b, "task-1", "claim", {}, alice).ok, false);
		assert.equal(run(b, "task-2", "release", {}, bob).ok, true);
		assert.equal(run(b, "task-1", "claim", {}, alice).ok, true);
		assert.equal(run(b, "task-1", "complete", {}, alice).ok, true);
		assert.equal(run(b, "task-2", "claim", {}, bob).ok, true);
	});

	it("refuses a reassign that would overlap", () => {
		const b = newTeam("s-1");
		add(b, "one", ["src/app"]);
		add(b, "two", ["src/app/file.ts"]);
		assert.equal(run(b, "task-1", "claim", {}, alice).ok, true);
		const refused = run(b, "task-2", "reassign", { owner: "bob" });
		assert.equal(refused.ok, false);
		if (!refused.ok) assert.match(refused.error, /overlaps task-1/);
		assert.equal(run(b, "task-2", "reassign", { owner: "" }).ok, true);
	});

	it("refuses an in-progress scope edit that would overlap", () => {
		const b = newTeam("s-1");
		add(b, "one", ["src/app"]);
		add(b, "two", ["src/ui"]);
		assert.equal(run(b, "task-1", "claim", {}, alice).ok, true);
		assert.equal(run(b, "task-2", "claim", {}, bob).ok, true);
		const refused = run(b, "task-1", "edit", { writeScopes: ["src/ui/app"] });
		assert.equal(refused.ok, false);
		if (!refused.ok) assert.match(refused.error, /change scopes/);
		assert.equal(run(b, "task-1", "edit", { writeScopes: ["src/server"] }).ok, true);
	});

	it("allows a pending scope edit even when it will overlap", () => {
		const b = newTeam("s-1");
		add(b, "one", ["src/app"]);
		add(b, "two", ["src/ui"]);
		assert.equal(run(b, "task-1", "claim", {}, alice).ok, true);
		assert.equal(run(b, "task-2", "edit", { writeScopes: ["src/app/ui"] }).ok, true);
	});

	it("reserves nothing for a task without scopes", () => {
		const b = newTeam("s-1");
		add(b, "one");
		add(b, "two", ["src/app"]);
		assert.equal(run(b, "task-1", "claim", {}, alice).ok, true);
		assert.equal(run(b, "task-2", "claim", {}, bob).ok, true);
	});
});
