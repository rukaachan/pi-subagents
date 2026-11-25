import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AgentTeamTaskView } from "../src/domain/agent-team/index.ts";
import { plainTheme } from "./board-fixtures.ts";
import { buildAgentTeamRows, renderAgentTeamScreen } from "../src/ui/view/workspace/index.ts";

function view(attempts: AgentTeamTaskView["task"]["attempts"]): AgentTeamTaskView {
	return {
		task: {
			id: "task-1",
			revision: 1,
			subject: "map the engine",
			description: "find the hot path",
			status: "pending",
			blockedBy: [],
			writeScopes: ["src"],
			createdAt: 1,
			updatedAt: 1,
			attempts,
		},
		ready: true,
		blockedByOpen: [],
		writeScopeWarnings: [],
	};
}

describe("agent team memory pane", () => {
	it("shows the two newest attempts and the fact count", () => {
		const rows = buildAgentTeamRows(
			[
				view([
					{ at: 1, outcome: "released", owner: "worker", error: "stuck" },
					{ at: 2, outcome: "failed", owner: "worker", error: "test still red" },
					{ at: 3, outcome: "passed", owner: "worker" },
				]),
			],
			() => false,
		);
		const out = renderAgentTeamScreen(rows, {
			width: 120,
			height: 20,
			cursor: 0,
			theme: plainTheme() as never,
			enabled: true,
			facts: 3,
		}).join("\n");
		assert.match(out, /failed: test still red/);
		assert.match(out, /passed/);
		assert.doesNotMatch(out, /stuck/);
		assert.match(out, /3 facts/);
	});
});
