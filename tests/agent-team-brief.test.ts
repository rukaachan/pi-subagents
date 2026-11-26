import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	agentTeamApi,
	beginAgentTeamSession,
	enableAgentTeam,
} from "../src/app/agent-team/board/index.ts";
import { waitForRunText } from "../src/app/agent-team/advisor/index.ts";
import { createAgentTeamTool } from "../src/infra/agent-team/tools/index.ts";

function call(tool: ReturnType<typeof createAgentTeamTool>, params: Record<string, unknown>) {
	const ctx = { sessionManager: { getSessionId: () => "s-brief" } };
	return tool.execute("call-1", params as never, undefined, undefined, ctx as never);
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content[0]?.text ?? "";
}

beforeEach(() => {
	beginAgentTeamSession("s-brief");
	enableAgentTeam();
});

describe("round brief", () => {
	it("returns a finished run's text", async () => {
		const result = await waitForRunText(
			{ get: () => ({ status: "done", result: { text: " hello " } }) } as never,
			"run-1",
			100,
			"brief",
		);
		assert.deepEqual(result, { ok: true, text: "hello" });
	});

	it("reports an error or empty run", async () => {
		const failed = await waitForRunText(
			{ get: () => ({ status: "error", error: "boom" }) } as never,
			"run-1",
			100,
			"brief",
		);
		assert.deepEqual(failed, { ok: false, error: "boom" });
		const empty = await waitForRunText(
			{ get: () => ({ status: "done", result: { text: "  " } }) } as never,
			"run-1",
			100,
			"brief",
		);
		assert.equal(empty.ok, false);
		if (!empty.ok) assert.match(empty.error, /returned no text/);
	});

	it("lets only the lead ask for a brief", async () => {
		let called = 0;
		const api = {
			...agentTeamApi,
			brief: async () => {
				called += 1;
				return { ok: true as const, text: "short brief" };
			},
		};
		const member = createAgentTeamTool(api, "alice");
		const refused = await call(member, { action: "brief" });
		assert.equal(refused.isError, true);
		assert.match(text(refused), /Only the lead/);
		assert.equal(called, 0);

		const lead = createAgentTeamTool(api);
		const result = await call(lead, { action: "brief", question: "what is next?" });
		assert.equal(result.isError, undefined);
		assert.match(text(result), /short brief/);
		assert.equal(called, 1);
	});
});
