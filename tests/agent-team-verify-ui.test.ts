import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	agentTeamSummary,
	beginAgentTeamSession,
	createTask,
	enableAgentTeam,
	getTask,
	updateTask,
} from "../src/app/agent-team/board/index.ts";
import { runAgentTeamAction } from "../src/ui/menu/board/agent-team-actions.ts";

beforeEach(() => {
	beginAgentTeamSession("s-ui-verify");
	enableAgentTeam();
});

function inReview(): void {
	createTask({ subject: "one", description: "", acceptance: "tests pass" });
	updateTask(
		{ taskId: "task-1", expectedRevision: 1, action: "claim" },
		{ name: "worker", lead: false },
	);
	updateTask(
		{ taskId: "task-1", expectedRevision: 2, action: "complete", result: "done" },
		{ name: "worker", lead: false },
	);
}

describe("manual verify flow", () => {
	it("journals the lead reason and keeps the optional fact", async () => {
		inReview();
		const answers = ["checked by hand", "parser reads UTF-8"];
		const notices: string[] = [];
		const ctx = {
			ui: {
				select: async () => "pass",
				input: async () => answers.shift(),
				notify: (text: string) => notices.push(text),
			},
		};
		await runAgentTeamAction(
			{ kind: "agent-team-verify", taskId: "task-1" },
			ctx as never,
			undefined as never,
			undefined as never,
		);
		const task = getTask("task-1")?.task;
		assert.equal(task?.status, "completed");
		assert.equal(task?.verdict, "pass");
		assert.equal(task?.verifiedBy, "lead");
		assert.equal(agentTeamSummary().facts, 1);
		assert.deepEqual(notices, ["verify · task-1"]);
	});

	it("keeps a dead end when the lead fails the task", async () => {
		inReview();
		const answers = ["no test covers CRLF", "No CRLF fixture exists"];
		const ctx = {
			ui: {
				select: async () => "fail",
				input: async () => answers.shift(),
				notify: () => {},
			},
		};
		await runAgentTeamAction(
			{ kind: "agent-team-verify", taskId: "task-1" },
			ctx as never,
			undefined as never,
			undefined as never,
		);
		const task = getTask("task-1")?.task;
		assert.equal(task?.status, "pending");
		assert.equal(task?.lastError, "no test covers CRLF");
		assert.equal(agentTeamSummary().facts, 0);
		assert.equal(task?.attempts?.[0]?.outcome, "failed");
	});
});
