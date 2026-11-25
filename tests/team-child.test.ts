import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	beginTeamSession,
	createTask,
	enableTeam,
	taskList,
	teamApi,
} from "../src/app/team-store.ts";
import { joinTeamChild, teamChildExtras } from "../src/app/team-child.ts";
import { createTeamTool } from "../src/infra/team/tools/index.ts";

beforeEach(() => {
	beginTeamSession("s-child");
});

describe("team child", () => {
	it("stays off while team mode is off", () => {
		assert.equal(joinTeamChild("worker"), undefined);
		assert.equal(teamChildExtras("worker"), undefined);
	});

	it("joins with a Team tool and a board prompt", () => {
		enableTeam();
		const child = joinTeamChild("worker");
		assert.ok(child);
		assert.equal(child.member, "worker");
		assert.equal(child.tools[0]?.name, "Team");
		assert.equal(child.tools[1]?.name, "TeamMessage");
		assert.match(child.prompt, /"worker"/);
		assert.match(child.prompt, /Claim|claim/);
		const extras = teamChildExtras("worker");
		assert.ok(extras);
		assert.deepEqual(extras.activate, ["Team", "TeamMessage"]);
		assert.equal(extras.member, "worker-2");
		assert.match(extras.promptPrefix ?? "", /"worker-2"/);
	});

	it("keeps one member name across retries of the same task", () => {
		enableTeam();
		const first = joinTeamChild("worker", "task-9");
		const second = joinTeamChild("worker", "task-9");
		assert.ok(first && second);
		assert.equal(first.member, "worker");
		assert.equal(second.member, "worker");
		assert.match(second.prompt, /"worker"/);
		const other = joinTeamChild("worker", "task-10");
		assert.equal(other?.member, "worker-2");
	});

	it("claims as the teammate, not as the lead", async () => {
		enableTeam();
		createTask({ subject: "one", description: "" });
		const child = joinTeamChild("worker");
		assert.ok(child);
		const tool = child.tools[0];
		assert.ok(tool);
		const ctx = { sessionManager: { getSessionId: () => "s-child" } };
		const claimed = await tool.execute(
			"id",
			{ action: "claim", task_id: "task-1", expected_revision: 1 } as never,
			undefined,
			undefined,
			ctx as never,
		);
		assert.equal(claimed.isError, undefined);
		assert.equal(taskList()[0]?.task.owner, "worker");
		const lead = createTeamTool(teamApi);
		const reassign = await lead.execute(
			"id",
			{ action: "reassign", task_id: "task-1", expected_revision: 2, owner: "lead" } as never,
			undefined,
			undefined,
			ctx as never,
		);
		assert.equal(reassign.isError, undefined);
		assert.equal(taskList()[0]?.task.owner, "lead");
	});

	it("refuses a claim that races the stop", async () => {
		enableTeam();
		createTask({ subject: "one", description: "" });
		const gate = { open: true };
		const child = joinTeamChild("worker", "run-a", gate);
		assert.ok(child);
		const tool = child.tools[0];
		assert.ok(tool);
		gate.open = false;
		const ctx = { sessionManager: { getSessionId: () => "s-child" } };
		const result = await tool.execute(
			"id",
			{ action: "claim", task_id: "task-1", expected_revision: 1 } as never,
			undefined,
			undefined,
			ctx as never,
		);
		assert.equal(result.isError, true);
		const body = result.content[0];
		if (body?.type === "text") assert.match(body.text, /has stopped/);
		assert.equal(taskList()[0]?.task.status, "pending");
	});
});
