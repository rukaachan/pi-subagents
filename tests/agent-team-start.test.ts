import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	beginAgentTeamSession,
	enableAgentTeam,
	agentTeamApi,
	agentTeamEnabled,
} from "../src/app/agent-team/board/index.ts";
import { createAgentTeamTool } from "../src/infra/agent-team/tools/index.ts";

function call(
	tool: ReturnType<typeof createAgentTeamTool>,
	params: Record<string, unknown>,
	sessionId = "s-start",
) {
	const ctx = { sessionManager: { getSessionId: () => sessionId } };
	return tool.execute("call-1", params as never, undefined, undefined, ctx as never);
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content[0]?.text ?? "";
}

beforeEach(() => {
	beginAgentTeamSession("s-start");
});

describe("team start", () => {
	it("requires the lead, a prompt, and a wired launch", async () => {
		const alice = createAgentTeamTool(agentTeamApi, "alice");
		const denied = await call(alice, { action: "start", prompt: "map auth" });
		assert.equal(denied.isError, true);
		assert.match(text(denied), /Only the lead/);

		const lead = createAgentTeamTool(agentTeamApi);
		for (const params of [{ action: "start" }, { action: "start", prompt: "   " }]) {
			const empty = await call(lead, params);
			assert.equal(empty.isError, true);
			assert.match(text(empty), /start needs prompt/);
			assert.equal(agentTeamEnabled(), false, "a refused start does not turn the board on");
		}

		const missing = await call(lead, { action: "start", prompt: "map auth" });
		assert.equal(missing.isError, true);
		assert.match(text(missing), /not available/);
		assert.equal(agentTeamEnabled(), false);
	});

	it("launches one worker per leg", async () => {
		const seen: unknown[] = [];
		const tool = createAgentTeamTool({
			...agentTeamApi,
			launch: async (input) => {
				seen.push(input);
				return {
					ok: true,
					agentTeamId: "s-start",
					runId: "run-x",
					tasks: [{ name: "worker", taskId: "task-1" }],
					started: 1,
					queued: 0,
				};
			},
		});
		const result = await call(tool, {
			action: "start",
			prompt: "map auth",
			roster: ["worker"],
		});
		assert.equal(result.isError, undefined);
		assert.deepEqual(seen, [{ prompt: "map auth", roster: ["worker"] }]);
		assert.match(text(result), /AgentTeam started · 1 started/);
		assert.match(text(result), /worker — task-1/);
	});

	it("keeps reassignment lead-only", async () => {
		enableAgentTeam();
		const lead = createAgentTeamTool(agentTeamApi);
		const alice = createAgentTeamTool(agentTeamApi, "alice");
		await call(lead, { action: "create", subject: "one", description: "" });
		const reassign = await call(alice, {
			action: "reassign",
			task_id: "task-1",
			expected_revision: 1,
			owner: "alice",
		});
		assert.equal(reassign.isError, true);
		assert.match(text(reassign), /Only the lead/);
	});
});
