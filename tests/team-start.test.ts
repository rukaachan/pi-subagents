import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { beginTeamSession, enableTeam, teamApi, teamEnabled } from "../src/app/team-store.ts";
import { createTeamTool } from "../src/infra/team-tool.ts";

function call(
	tool: ReturnType<typeof createTeamTool>,
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
	beginTeamSession("s-start");
});

describe("team start", () => {
	it("requires the lead, a prompt, and a wired launch", async () => {
		const alice = createTeamTool(teamApi, "alice");
		const denied = await call(alice, { action: "start", prompt: "map auth" });
		assert.equal(denied.isError, true);
		assert.match(text(denied), /Only the lead/);

		const lead = createTeamTool(teamApi);
		for (const params of [{ action: "start" }, { action: "start", prompt: "   " }]) {
			const empty = await call(lead, params);
			assert.equal(empty.isError, true);
			assert.match(text(empty), /start needs prompt/);
			assert.equal(teamEnabled(), false, "a refused start does not turn the board on");
		}

		const missing = await call(lead, { action: "start", prompt: "map auth" });
		assert.equal(missing.isError, true);
		assert.match(text(missing), /not available/);
		assert.equal(teamEnabled(), false);
	});

	it("launches one worker per leg", async () => {
		const seen: unknown[] = [];
		const tool = createTeamTool({
			...teamApi,
			launch: async (input) => {
				seen.push(input);
				return {
					ok: true,
					teamId: "s-start",
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
		assert.match(text(result), /Team started · 1 started/);
		assert.match(text(result), /worker — task-1/);
	});

	it("keeps reassignment lead-only", async () => {
		enableTeam();
		const lead = createTeamTool(teamApi);
		const alice = createTeamTool(teamApi, "alice");
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
