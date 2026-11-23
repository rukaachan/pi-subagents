import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	beginTeamSession,
	createTask,
	disableTeam,
	enableTeam,
	joinTeam,
	teamApi,
	updateTask,
} from "../src/app/team-store.ts";
import { createTeamTool } from "../src/infra/team-tool.ts";

function call(
	tool: ReturnType<typeof createTeamTool>,
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
	enableTeam();
	joinTeam("alice", "run-alice");
	createTask({ subject: "wide", description: "", writeScopes: ["src"] });
	createTask({ subject: "narrow", description: "", writeScopes: ["src/a"] });
	const claimed = updateTask(
		{ taskId: "task-2", expectedRevision: 1, action: "claim" },
		{ name: "alice", lead: false },
	);
	assert.equal(claimed.ok, true);
}

beforeEach(() => {
	beginTeamSession("s-resolve");
});

describe("team resolve", () => {
	it("names the blocker, owner, revision, and live state without mutating", async () => {
		setupConflict();
		const before = teamApi.get("task-1")?.task.revision;
		const tool = createTeamTool({ ...teamApi, isLive: () => true });
		const result = await call(tool, { action: "resolve", task_id: "task-1" });
		const body = text(result);
		assert.match(body, /task-2/);
		assert.match(body, /\[in_progress\] rev 2/);
		assert.match(body, /src\/a/);
		assert.match(body, /alice/);
		assert.match(body, /live/);
		assert.match(body, /narrow/);
		assert.equal(teamApi.get("task-1")?.task.revision, before);
		assert.equal(teamApi.get("task-2")?.task.revision, 2);
	});

	it("suggests release when the owner is not live", async () => {
		setupConflict();
		const tool = createTeamTool({ ...teamApi, isLive: () => false });
		const result = await call(tool, { action: "resolve", task_id: "task-1" });
		assert.match(text(result), /not live/);
		assert.match(
			text(result),
			/Team \{ action: "release", task_id: "task-2", expected_revision: 2 \}, then claim task-1/,
		);
	});

	it("says unknown when no live lookup is wired", async () => {
		setupConflict();
		const result = await call(createTeamTool(teamApi), {
			action: "resolve",
			task_id: "task-1",
		});
		assert.match(text(result), /unknown/);
	});

	it("reports a task with no scope conflict", async () => {
		enableTeam();
		createTask({ subject: "docs", description: "", writeScopes: ["docs"] });
		const result = await call(createTeamTool(teamApi), {
			action: "resolve",
			task_id: "task-1",
		});
		assert.match(text(result), /No scope conflict/);
	});

	it("is read-only while team mode is off, and refuses a child", async () => {
		setupConflict();
		disableTeam();
		const lead = createTeamTool(teamApi);
		const read = await call(lead, { action: "resolve", task_id: "task-1" });
		assert.equal(read.isError, undefined);
		assert.match(text(read), /task-2/);
		const child = await call(createTeamTool(teamApi, "alice"), {
			action: "resolve",
			task_id: "task-1",
		});
		assert.equal(child.isError, true);
		assert.match(text(child), /Only the lead/);
	});

	it("refuses a missing or unknown task id", async () => {
		const tool = createTeamTool(teamApi);
		const missing = await call(tool, { action: "resolve" });
		assert.match(text(missing), /needs task_id/);
		const unknown = await call(tool, { action: "resolve", task_id: "task-99" });
		assert.match(text(unknown), /Unknown task/);
	});
});
