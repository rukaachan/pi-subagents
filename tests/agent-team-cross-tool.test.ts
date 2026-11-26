import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	agentTeamApi,
	beginAgentTeamSession,
	enableAgentTeam,
	taskList,
} from "../src/app/agent-team/board/index.ts";
import type { AgentTeamTaskView, AgentTeamUpdate } from "../src/domain/agent-team/index.ts";
import { createAgentTeamTool } from "../src/infra/agent-team/tools/index.ts";

function view(over: Partial<AgentTeamTaskView["task"]> = {}): AgentTeamTaskView {
	return {
		task: {
			id: "task-1",
			revision: 1,
			subject: "one",
			description: "",
			status: "in_review",
			blockedBy: [],
			writeScopes: [],
			acceptance: "tests pass",
			crossVerify: true,
			verdict: "pass",
			createdAt: 1,
			updatedAt: 1,
			...over,
		},
		ready: true,
		blockedByOpen: [],
		writeScopeWarnings: [],
	};
}

function call(tool: ReturnType<typeof createAgentTeamTool>, params: Record<string, unknown>) {
	const ctx = { sessionManager: { getSessionId: () => "s-cross-tool" } };
	return tool.execute("call-1", params as never, undefined, undefined, ctx as never);
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content[0]?.text ?? "";
}

beforeEach(() => {
	beginAgentTeamSession("s-cross-tool");
	enableAgentTeam();
});

describe("cross verification tool", () => {
	it("passes scope cross and does not launch another cross reader", async () => {
		let seen: AgentTeamUpdate | undefined;
		let cross = 0;
		const task = view();
		const tool = createAgentTeamTool({
			...agentTeamApi,
			update: (update) => {
				seen = update;
				return { ok: true, task: task.task };
			},
			get: () => task,
			startCrossVerify: () => {
				cross += 1;
			},
		});
		const result = await call(tool, {
			action: "verify",
			task_id: "task-1",
			expected_revision: 1,
			verdict: "pass",
			scope: "cross",
		});
		assert.equal(result.isError, undefined);
		assert.equal(seen?.scope, "cross");
		assert.equal(cross, 0);
	});

	it("starts the cross reader after the first verifier passes", async () => {
		let cross = 0;
		const task = view();
		const tool = createAgentTeamTool({
			...agentTeamApi,
			update: () => ({ ok: true, task: task.task }),
			get: () => task,
			startCrossVerify: () => {
				cross += 1;
			},
		});
		const result = await call(tool, {
			action: "verify",
			task_id: "task-1",
			expected_revision: 1,
			verdict: "pass",
		});
		assert.equal(result.isError, undefined);
		assert.equal(cross, 1);
	});

	it("dispatches worktree status for the lead", async () => {
		let seen: { id: string; action: string } | undefined;
		const task = view();
		const tool = createAgentTeamTool({
			...agentTeamApi,
			agentTeamId: () => "s-cross-tool",
			worktree: (id, action) => {
				seen = { id, action };
				return { ok: true, text: "clean", task: task.task };
			},
		});
		const result = await call(tool, {
			action: "worktree",
			task_id: "task-1",
			worktree_action: "status",
		});
		assert.equal(result.isError, undefined);
		assert.deepEqual(seen, { id: "task-1", action: "status" });
	});

	it("dispatches promote preview for the lead", async () => {
		let seen: { id: string; confirm: boolean } | undefined;
		const tool = createAgentTeamTool({
			...agentTeamApi,
			agentTeamId: () => "s-cross-tool",
			promote: (id, confirm) => {
				seen = { id, confirm };
				return { ok: true, name: "draft", content: "preview", written: false };
			},
		});
		const result = await call(tool, { action: "promote", task_id: "task-1" });
		assert.equal(result.isError, undefined);
		assert.deepEqual(seen, { id: "task-1", confirm: false });
	});

	it("creates an opted-in task and refuses one without acceptance", async () => {
		enableAgentTeam();
		const tool = createAgentTeamTool(agentTeamApi);
		const made = await call(tool, {
			action: "create",
			subject: "one",
			description: "",
			acceptance: "tests pass",
			cross_verify: true,
		});
		assert.equal(made.isError, undefined);
		assert.equal(taskList()[0]?.task.crossVerify, true);
		const refused = await call(tool, {
			action: "create",
			subject: "two",
			description: "",
			cross_verify: true,
		});
		assert.equal(refused.isError, true);
		assert.match(text(refused), /needs acceptance/);
	});
});
