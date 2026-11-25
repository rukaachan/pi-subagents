import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	agentTeamSummary,
	createTask,
	enableAgentTeam,
	joinAgentTeam,
	taskList,
	updateTask,
} from "../src/app/agent-team/board/index.ts";
import { testRuntime } from "./runtime-fixture.ts";

const runtime = testRuntime();
const dir = mkdtempSync(join(tmpdir(), "pi-team-memory-"));

after(() => {
	runtime.stop();
	delete process.env.PI_SUBAGENTS_STATE;
	rmSync(dir, { recursive: true, force: true });
});

describe("team memory persistence", () => {
	it("restores the ledger and attempt history", () => {
		process.env.PI_SUBAGENTS_STATE = join(dir, "memory.json");
		runtime.begin(dir, "s-e");
		enableAgentTeam();
		joinAgentTeam("worker", "run-e");
		createTask({ subject: "Keep a fact", description: "", acceptance: "tests pass" });
		createTask({ subject: "Release me", description: "" });
		updateTask(
			{ taskId: "task-2", expectedRevision: 1, action: "claim" },
			{ name: "worker", lead: false },
		);
		updateTask(
			{ taskId: "task-2", expectedRevision: 2, action: "release", note: "blocked" },
			{ name: "worker", lead: false },
		);
		updateTask(
			{ taskId: "task-1", expectedRevision: 1, action: "claim" },
			{ name: "worker", lead: false },
		);
		updateTask(
			{ taskId: "task-1", expectedRevision: 2, action: "complete", result: "done" },
			{ name: "worker", lead: false },
		);
		updateTask(
			{
				taskId: "task-1",
				expectedRevision: 3,
				action: "verify",
				verdict: "pass",
				fact: "parser reads UTF-8",
			},
			{ name: "verifier", lead: false, role: "verifier" },
		);
		runtime.stop();
		runtime.begin(dir, "s-f");

		assert.equal(agentTeamSummary().facts, 1);
		const rows = taskList();
		assert.equal(rows[1]?.task.attempts?.[0]?.outcome, "released");
		assert.equal(rows[1]?.task.attempts?.[0]?.error, "blocked");
		assert.equal(rows[0]?.task.attempts?.[0]?.outcome, "passed");
		assert.equal(taskList({ status: "completed" }).length, 1);
	});
});
