import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	createTeamTask,
	newTeam,
	type TeamBoard,
	type TeamMember,
	type TeamUpdate,
} from "../src/domain/team.ts";
import { updateTeamTask } from "../src/domain/team-update.ts";

const lead = { name: "lead", lead: true };
const alice = { name: "alice", lead: false };
const bob = { name: "bob", lead: false };
const members: TeamMember[] = [
	{ name: "alice", starter: "worker", joinedAt: 1 },
	{ name: "bob", starter: "worker", joinedAt: 2 },
];

function add(board: TeamBoard, subject = "one"): void {
	const result = createTeamTask(board, { subject, description: "" }, 10);
	if (!result.ok) throw new Error(result.error);
}

function at(
	board: TeamBoard,
	revision: number,
	action: TeamUpdate["action"],
	extra: Partial<TeamUpdate> = {},
	who = lead,
) {
	return updateTeamTask(
		board,
		{ taskId: "task-1", expectedRevision: revision, action, ...extra },
		who,
		members,
		20,
	);
}

describe("team stale retry", () => {
	it("retries a stale claim once and reports the old revision", () => {
		const b = newTeam("s-1");
		add(b);
		assert.equal(at(b, 1, "edit", { subject: "renamed" }).ok, true);
		const claimed = at(b, 1, "claim", {}, alice);
		assert.equal(claimed.ok, true);
		if (claimed.ok) {
			assert.equal(claimed.retriedFrom, 1);
			assert.equal(claimed.task.owner, "alice");
			assert.equal(claimed.task.revision, 3);
		}
	});

	it("never retries an edit", () => {
		const b = newTeam("s-1");
		add(b);
		assert.equal(at(b, 1, "edit", { subject: "renamed" }).ok, true);
		const stale = at(b, 1, "edit", { description: "new text" });
		assert.equal(stale.ok, false);
		if (!stale.ok) assert.match(stale.error, /changed \(revision 2, expected 1\)/);
	});

	it("never retries a dependency rewrite", () => {
		const b = newTeam("s-1");
		add(b);
		assert.equal(at(b, 1, "edit", { subject: "renamed" }).ok, true);
		const stale = at(b, 1, "edit", { blockedBy: [] });
		assert.equal(stale.ok, false);
		if (!stale.ok) assert.match(stale.error, /changed/);
	});

	it("returns the semantic error when the retry cannot apply", () => {
		const b = newTeam("s-1");
		add(b);
		assert.equal(at(b, 1, "claim", {}, alice).ok, true);
		const late = at(b, 1, "claim", {}, bob);
		assert.equal(late.ok, false);
		if (!late.ok) assert.match(late.error, /owned by alice/);
	});

	it("does not retry a revision that is ahead of the board", () => {
		const b = newTeam("s-1");
		add(b);
		const ahead = at(b, 5, "claim", {}, alice);
		assert.equal(ahead.ok, false);
		if (!ahead.ok) assert.match(ahead.error, /changed \(revision 1, expected 5\)/);
	});
});
