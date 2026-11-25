import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	beginAgentTeamSession,
	createTask,
	disableAgentTeam,
	enableAgentTeam,
	joinAgentTeam,
	agentTeamApi,
	updateTask,
} from "../src/app/agent-team/board/index.ts";
import { createAgentTeamTool } from "../src/infra/agent-team/tools/index.ts";

function call(
	tool: ReturnType<typeof createAgentTeamTool>,
	params: Record<string, unknown>,
	sessionId = "s-resolve",
) {
	const ctx = { sessionManager: { getSessionId: () => sessionId } };
	return tool.execute("call-1", params as never, undefined, undefined, ctx as never);
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content[0]?.text ?? "";
}

function setupConflict() {
	enableAgentTeam();
	joinAgentTeam("alice", "run-alice");
	createTask({ subject: "wide", description: "", writeScopes: ["src"] });
	createTask({ subject: "narrow", description: "", writeScopes: ["src/a"] });
	const claimed = updateTask(
		{ taskId: "task-2", expectedRevision: 1, action: "claim" },
		{ name: "alice", lead: false },
	);
	assert.equal(claimed.ok, true);
}

beforeEach(() => {
	beginAgentTeamSession("s-resolve");
});

describe("team resolve", () => {
	it("names the blocker, owner, revision, and live state without mutating", async () => {
		setupConflict();
		const before = agentTeamApi.get("task-1")?.task.revision;
		const tool = createAgentTeamTool({ ...agentTeamApi, isLive: () => true });
		const result = await call(tool, { action: "resolve", task_id: "task-1" });
		const body = text(result);
		assert.match(body, /task-2/);
		assert.match(body, /\[in_progress\] rev 2/);
		assert.match(body, /src\/a/);
		assert.match(body, /alice/);
		assert.match(body, /live/);
		assert.match(body, /narrow/);
		assert.equal(agentTeamApi.get("task-1")?.task.revision, before);
		assert.equal(agentTeamApi.get("task-2")?.task.revision, 2);
	});

	it("suggests release when the owner is not live", async () => {
		setupConflict();
		const tool = createAgentTeamTool({ ...agentTeamApi, isLive: () => false });
		const result = await call(tool, { action: "resolve", task_id: "task-1" });
		assert.match(text(result), /not live/);
		assert.match(
			text(result),
			/Team \{ action: "release", task_id: "task-2", expected_revision: 2 \}, then claim task-1/,
		);
	});

	it("says unknown when no live lookup is wired", async () => {
		setupConflict();
		const result = await call(createAgentTeamTool(agentTeamApi), {
			action: "resolve",
			task_id: "task-1",
		});
		assert.match(text(result), /unknown/);
	});

	it("reports a task with no scope conflict", async () => {
		enableAgentTeam();
		createTask({ subject: "docs", description: "", writeScopes: ["docs"] });
		const result = await call(createAgentTeamTool(agentTeamApi), {
			action: "resolve",
			task_id: "task-1",
		});
		assert.match(text(result), /No scope conflict/);
	});

	it("is read-only while team mode is off, and refuses a child", async () => {
		setupConflict();
		disableAgentTeam();
		const lead = createAgentTeamTool(agentTeamApi);
		const read = await call(lead, { action: "resolve", task_id: "task-1" });
		assert.equal(read.isError, undefined);
		assert.match(text(read), /task-2/);
		const child = await call(createAgentTeamTool(agentTeamApi, "alice"), {
			action: "resolve",
			task_id: "task-1",
		});
		assert.equal(child.isError, true);
		assert.match(text(child), /Only the lead/);
	});

	it("refuses a missing or unknown task id", async () => {
		const tool = createAgentTeamTool(agentTeamApi);
		const missing = await call(tool, { action: "resolve" });
		assert.match(text(missing), /needs task_id/);
		const unknown = await call(tool, { action: "resolve", task_id: "task-99" });
		assert.match(text(unknown), /Unknown task/);
	});
});
