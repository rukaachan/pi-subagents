import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	beginTeamSession,
	createTask,
	enableTeam,
	joinTeam,
	teamMembers,
	updateTask,
} from "../src/app/team-store.ts";
import { MAX_TEAM_MEMBERS } from "../src/domain/team/index.ts";

function seatTeam(): string[] {
	const names: string[] = [];
	for (let i = 0; i < MAX_TEAM_MEMBERS; i += 1) names.push(joinTeam(`m${i}`));
	return names;
}

function createMine(names: readonly string[]): void {
	for (let i = 0; i < names.length; i += 1) {
		const created = createTask({ subject: `task ${i + 1}`, description: "" });
		assert.equal(created.ok, true);
		const claimed = updateTask(
			{ taskId: `task-${i + 1}`, expectedRevision: 1, action: "claim" },
			{ name: names[i] ?? "", lead: false },
		);
		assert.equal(claimed.ok, true);
	}
}

function completeMine(names: readonly string[]): void {
	for (let i = 0; i < names.length; i += 1) {
		const done = updateTask(
			{ taskId: `task-${i + 1}`, expectedRevision: 2, action: "complete" },
			{ name: names[i] ?? "", lead: false },
		);
		assert.equal(done.ok, true);
	}
}

beforeEach(() => {
	beginTeamSession("s-cap");
});

describe("team member cap", () => {
	it("refuses a new member when every seat owns a live task", () => {
		enableTeam();
		const names = seatTeam();
		createMine(names);
		assert.throws(() => joinTeam("late"), /full/i);
		assert.equal(teamMembers().length, MAX_TEAM_MEMBERS);
	});

	it("frees a seat whose task is completed", () => {
		enableTeam();
		const names = seatTeam();
		createMine(names);
		completeMine(names);
		const joined = joinTeam("late");
		assert.equal(teamMembers().length, MAX_TEAM_MEMBERS);
		assert.ok(teamMembers().some((member) => member.name === joined));
	});
});
