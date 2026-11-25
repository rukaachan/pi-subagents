import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	beginAgentTeamSession,
	createTask,
	enableAgentTeam,
	taskList,
	agentTeamApi,
} from "../src/app/agent-team/board/index.ts";
import { joinAgentTeamChild, agentTeamChildExtras } from "../src/app/agent-team/child/index.ts";
import { createAgentTeamTool } from "../src/infra/agent-team/tools/index.ts";

beforeEach(() => {
	beginAgentTeamSession("s-child");
});

describe("team child", () => {
	it("stays off while team mode is off", () => {
		assert.equal(joinAgentTeamChild("worker"), undefined);
		assert.equal(agentTeamChildExtras("worker"), undefined);
	});

	it("joins with a Team tool and a board prompt", () => {
		enableAgentTeam();
		const child = joinAgentTeamChild("worker");
		assert.ok(child);
		assert.equal(child.member, "worker");
		assert.equal(child.tools[0]?.name, "AgentTeam");
		assert.equal(child.tools[1]?.name, "AgentTeamMessage");
		assert.match(child.prompt, /"worker"/);
		assert.match(child.prompt, /Use the AgentTeam tool/);
		assert.doesNotMatch(child.prompt, /AgentAgent/);
		assert.match(child.prompt, /Claim|claim/);
		const extras = agentTeamChildExtras("worker");
		assert.ok(extras);
		assert.deepEqual(extras.activate, ["AgentTeam", "AgentTeamMessage"]);
		assert.equal(extras.member, "worker-2");
		assert.match(extras.promptPrefix ?? "", /"worker-2"/);
	});

	it("keeps one member name across retries of the same task", () => {
		enableAgentTeam();
		const first = joinAgentTeamChild("worker", "task-9");
		const second = joinAgentTeamChild("worker", "task-9");
		assert.ok(first && second);
		assert.equal(first.member, "worker");
		assert.equal(second.member, "worker");
		assert.match(second.prompt, /"worker"/);
		const other = joinAgentTeamChild("worker", "task-10");
		assert.equal(other?.member, "worker-2");
	});

	it("claims as the teammate, not as the lead", async () => {
		enableAgentTeam();
		createTask({ subject: "one", description: "" });
		const child = joinAgentTeamChild("worker");
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
		const lead = createAgentTeamTool(agentTeamApi);
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
		enableAgentTeam();
		createTask({ subject: "one", description: "" });
		const gate = { open: true };
		const child = joinAgentTeamChild("worker", "run-a", gate);
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
