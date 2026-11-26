import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AgentTeamTaskView } from "../src/domain/agent-team/index.ts";
import { buildAgentTeamRows, renderAgentTeamScreen } from "../src/ui/view/workspace/index.ts";
import { plainTheme } from "./board-fixtures.ts";

function agentTeamView(over: Partial<AgentTeamTaskView["task"]> = {}): AgentTeamTaskView {
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
			...over,
		},
		ready: true,
		blockedByOpen: [],
		writeScopeWarnings: [],
	};
}

describe("mission control rounds", () => {
	it("shows the round, its budget, and its spend", () => {
		const rows = buildAgentTeamRows(
			[agentTeamView({ round: 2, status: "in_progress" })],
			() => false,
		);
		const out = renderAgentTeamScreen(rows, {
			width: 120,
			height: 12,
			cursor: 0,
			theme: plainTheme() as never,
			enabled: true,
			rounds: [{ id: 2, tokens: 1_000, ms: 60_000, spent: 250, elapsedMs: 60_000 }],
		}).join("\n");
		assert.match(out, /r2/);
		assert.match(out, /round 2 · 250\/1000 tokens · 1\/1 min/);
	});

	it("shows both reader verdicts", () => {
		const rows = buildAgentTeamRows(
			[
				agentTeamView({
					status: "in_review",
					verdict: "pass",
					crossVerify: true,
					crossVerdict: "fail",
					crossVerifiedBy: "tester",
				}),
			],
			() => false,
		);
		const out = renderAgentTeamScreen(rows, {
			width: 120,
			height: 12,
			cursor: 0,
			theme: plainTheme() as never,
			enabled: true,
			rounds: [],
		}).join("\n");
		assert.match(out, /cross: fail by tester/);
	});
});
