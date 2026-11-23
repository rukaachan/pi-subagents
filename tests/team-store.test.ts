import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	beginTeamSession,
	createTask,
	disableTeam,
	enableTeam,
	joinTeam,
	teamApi,
	teamEnabled,
	teamMembers,
	teamSummary,
	taskList,
	updateTask,
} from "../src/app/team-store.ts";
import { beginSession, stopPersistence } from "../src/app/live-store.ts";
import { createTeamTool } from "../src/infra/team-tool.ts";

function call(
	tool: ReturnType<typeof createTeamTool>,
	params: Record<string, unknown>,
	sessionId = "s-team",
) {
	const ctx = { sessionManager: { getSessionId: () => sessionId } };
	return tool.execute("call-1", params as never, undefined, undefined, ctx as never);
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content[0]?.text ?? "";
}

beforeEach(() => {
	beginTeamSession("s-team");
});

describe("team store", () => {
	it("starts off and joins unique, readable names", () => {
		assert.equal(teamEnabled(), false);
		enableTeam();
		assert.equal(teamEnabled(), true);
		assert.equal(joinTeam("worker"), "worker");
		assert.equal(joinTeam("worker"), "worker-2");
		assert.equal(joinTeam("lead"), "member");
	});

	it("keeps tasks when a saved board is enabled under another id", () => {
		enableTeam();
		createTask({ subject: "kept", description: "" });
		beginTeamSession("local");
		enableTeam("s-other");
		assert.equal(taskList().length, 0);
		teamApi.create({ subject: "restored", description: "" });
		enableTeam("s-third");
		assert.equal(taskList().length, 1);
	});

	it("lists only live tasks and honors filters", () => {
		enableTeam();
		createTask({ subject: "one", description: "" });
		createTask({ subject: "two", description: "" });
		assert.equal(taskList().length, 2);
		assert.equal(taskList({ status: "pending" }).length, 2);
		assert.equal(taskList({ unowned: true }).length, 2);
		assert.equal(taskList({ ready: true }).length, 2);
	});

	it("rejects updates while team mode is off only at the tool layer", () => {
		createTask({ subject: "one", description: "" });
		const result = updateTask(
			{ taskId: "task-1", expectedRevision: 1, action: "claim" },
			{ name: "alice", lead: false },
		);
		assert.equal(result.ok, true);
	});
});

describe("team tool", () => {
	it("explains how to turn team mode on", async () => {
		const result = await call(createTeamTool(teamApi), { action: "create", subject: "x" });
		assert.equal(result.isError, true);
		assert.match(text(result), /Team mode is off/);
	});

	it("lets a claimed task finish after team mode is turned off", async () => {
		const lead = createTeamTool(teamApi);
		const alice = createTeamTool(teamApi, "alice");
		enableTeam();
		await call(lead, { action: "create", subject: "one", description: "" });
		await call(alice, { action: "claim", task_id: "task-1", expected_revision: 1 });
		disableTeam();
		const done = await call(alice, {
			action: "complete",
			task_id: "task-1",
			expected_revision: 2,
		});
		assert.equal(done.isError, undefined);
		assert.equal(teamSummary().done, 1);
	});

	it("runs create, list, claim, and complete", async () => {
		const lead = createTeamTool(teamApi);
		const alice = createTeamTool(teamApi, "alice");
		enableTeam();
		const created = await call(lead, {
			action: "create",
			subject: "Fix parser",
			description: "Make tests pass.",
			write_scopes: ["src/app"],
		});
		assert.match(text(created), /task-1/);
		const listed = await call(alice, { action: "list", ready: true });
		assert.match(text(listed), /Fix parser/);
		const claimed = await call(alice, {
			action: "claim",
			task_id: "task-1",
			expected_revision: 1,
		});
		assert.equal(claimed.isError, undefined);
		assert.match(text(claimed), /alice/);
		const stale = await call(alice, {
			action: "edit",
			task_id: "task-1",
			expected_revision: 1,
			subject: "renamed",
		});
		assert.equal(stale.isError, true);
		assert.match(text(stale), /revision 2/);
		const done = await call(alice, {
			action: "complete",
			task_id: "task-1",
			expected_revision: 2,
		});
		assert.equal(done.isError, undefined);
		const summary = teamSummary();
		assert.equal(summary.open, 0);
		assert.equal(summary.done, 1);
	});

	it("never reuses a live owner's name at the member cap", async () => {
		enableTeam();
		const owner = joinTeam("worker");
		await call(createTeamTool(teamApi), { action: "create", subject: "one", description: "" });
		await call(createTeamTool(teamApi, owner), {
			action: "claim",
			task_id: "task-1",
			expected_revision: 1,
		});
		for (let i = 1; i < 32; i += 1) joinTeam(`m${i}`);
		assert.notEqual(joinTeam("worker"), owner);
		assert.ok(teamMembers().some((member) => member.name === owner));
	});

	it("lists members in the status view", async () => {
		const lead = createTeamTool(teamApi);
		enableTeam();
		joinTeam("worker");
		const body = text(await call(lead, { action: "status" }));
		assert.match(body, /1 members/);
		assert.match(body, /Members: worker/);
	});

	it("requires a revision on a mutation", async () => {
		const lead = createTeamTool(teamApi);
		enableTeam();
		await call(lead, { action: "create", subject: "one", description: "" });
		const result = await call(lead, { action: "claim", task_id: "task-1" });
		assert.equal(result.isError, true);
		assert.match(text(result), /expected_revision/);
	});
});

describe("team persistence", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-team-"));
	after(() => {
		stopPersistence();
		delete process.env.PI_SUBAGENTS_STATE;
		rmSync(dir, { recursive: true, force: true });
	});

	it("restores tasks and owners after a session reload", () => {
		process.env.PI_SUBAGENTS_STATE = join(dir, "state.json");
		beginSession(dir, "s-a");
		enableTeam();
		joinTeam("worker");
		createTask({ subject: "Persisted", description: "detail", writeScopes: ["src"] });
		updateTask(
			{ taskId: "task-1", expectedRevision: 1, action: "reassign", owner: "worker" },
			{ name: "lead", lead: true },
		);
		updateTask(
			{ taskId: "task-1", expectedRevision: 2, action: "complete" },
			{ name: "worker", lead: false },
		);
		stopPersistence();

		beginSession(dir, "s-b");
		const summary = teamSummary();
		assert.equal(summary.enabled, true);
		assert.equal(summary.done, 1);
		const task = taskList()[0];
		assert.ok(task);
		assert.equal(task.task.subject, "Persisted");
		assert.equal(task.task.owner, "worker");
		assert.deepEqual(task.task.writeScopes, ["src"]);
	});

	it("releases a task that was claimed when Pi stopped", () => {
		process.env.PI_SUBAGENTS_STATE = join(dir, "stop.json");
		beginSession(dir, "s-c");
		enableTeam();
		joinTeam("worker", "run-a");
		createTask({ subject: "In flight", description: "" });
		updateTask(
			{ taskId: "task-1", expectedRevision: 1, action: "claim" },
			{ name: "worker", lead: false },
		);
		stopPersistence();

		beginSession(dir, "s-d");
		const task = taskList()[0]?.task;
		assert.equal(task?.status, "pending");
		assert.equal(task?.owner, undefined);
		assert.equal(task?.revision, 3);
		assert.equal(task?.lastOwner, "worker");
		assert.equal(task?.lastError, "Pi restarted");
	});
});
