import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	beginAgentTeamSession,
	createTask,
	enableAgentTeam,
	joinAgentTeam,
	agentTeamMembers,
	updateTask,
} from "../src/app/agent-team/board/index.ts";
import { MAX_AGENT_TEAM_MEMBERS } from "../src/domain/agent-team/index.ts";

function seatAgentTeam(): string[] {
	const names: string[] = [];
	for (let i = 0; i < MAX_AGENT_TEAM_MEMBERS; i += 1) names.push(joinAgentTeam(`m${i}`));
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
	beginAgentTeamSession("s-cap");
});

describe("team member cap", () => {
	it("refuses a new member when every seat owns a live task", () => {
		enableAgentTeam();
		const names = seatAgentTeam();
		createMine(names);
		assert.throws(() => joinAgentTeam("late"), /full/i);
		assert.equal(agentTeamMembers().length, MAX_AGENT_TEAM_MEMBERS);
	});

	it("frees a seat whose task is completed", () => {
		enableAgentTeam();
		const names = seatAgentTeam();
		createMine(names);
		completeMine(names);
		const joined = joinAgentTeam("late");
		assert.equal(agentTeamMembers().length, MAX_AGENT_TEAM_MEMBERS);
		assert.ok(agentTeamMembers().some((member) => member.name === joined));
	});
});
