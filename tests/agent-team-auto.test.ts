import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SubagentConfig } from "../src/domain/subagent/index.ts";
import {
	beginAgentTeamSession,
	createTask,
	disableAgentTeam,
	enableAgentTeam,
	getTask,
	joinAgentTeam,
	setAgentTeamChangeHook,
} from "../src/app/agent-team/board/index.ts";
import { completeTask, ensureTask, taskPrompt } from "../src/app/agent-team/auto/index.ts";

const sub: SubagentConfig = {
	name: "worker",
	description: "",
	model: "test",
	autonomy: "inherit",
	systemPrompt: "",
	source: "user",
	filePath: "",
	warnings: [],
};

function start(on = true): void {
	setAgentTeamChangeHook(null);
	beginAgentTeamSession("auto-test");
	if (on) {
		enableAgentTeam();
		joinAgentTeam("worker", "key");
	} else disableAgentTeam();
}

describe("automatic board tasks", () => {
	it("creates no task while the toggle is off", () => {
		start(false);
		const result = ensureTask({ sub, prompt: "Do work", origin: "task", member: "worker" });
		assert.deepEqual(result, { ok: true });
	});

	it("creates, links, assigns, and completes one task", () => {
		start();
		const result = ensureTask({
			sub,
			prompt: "Do work",
			origin: "task",
			runId: "run-1",
			member: "worker",
		});
		assert.ok(result.ok && result.taskId);
		const view = getTask(result.taskId);
		assert.equal(view?.task.status, "in_progress");
		assert.equal(view?.task.owner, "worker");
		assert.equal(view?.task.runId, "run-1");
		assert.equal(view?.task.origin, "task");
		completeTask(result.taskId, "finished");
		const done = getTask(result.taskId);
		assert.equal(done?.task.status, "completed");
		assert.equal(done?.task.result, "finished");
	});

	it("reuses the task named in the prompt instead of making a second one", () => {
		start();
		const manual = createTask({ subject: "manual", description: "" });
		assert.ok(manual.ok);
		const result = ensureTask({
			sub,
			prompt: `Claim ${manual.task.id} and finish it`,
			origin: "task",
			member: "worker",
		});
		assert.deepEqual(result, { ok: true, taskId: manual.task.id });
		assert.equal(getTask(manual.task.id)?.task.owner, "worker");
		assert.equal(getTask(manual.task.id)?.task.revision, 2, "assignment bumps once");
	});

	it("names the role in the prompt", () => {
		assert.match(taskPrompt("task-1", "worker"), /Board task task-1/);
		assert.match(taskPrompt("task-1", "verifier"), /verifier/);
		assert.match(taskPrompt("task-1", "advisor"), /advisor/);
	});
});
