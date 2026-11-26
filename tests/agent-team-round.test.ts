import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { beginAgentTeamSession, agentTeamApi } from "../src/app/agent-team/board/index.ts";
import {
	newAgentTeam,
	type AgentTeamBoard,
	type AgentTeamRound,
} from "../src/domain/agent-team/index.ts";
import {
	clampRoundBudget,
	nextRoundId,
	roundRefusal,
	roundSpentTokens,
} from "../src/domain/agent-team/lifecycle/index.ts";
import { createAgentTeamTask } from "../src/domain/team-tasks/index.ts";
import { createAgentTeamTool } from "../src/infra/agent-team/tools/index.ts";

function round(id: number, overrides: Partial<AgentTeamRound> = {}): AgentTeamRound {
	return {
		id,
		prompt: "ship it",
		taskIds: ["task-1"],
		budget: { tokens: 100, ms: 60_000 },
		startedAt: 1_000,
		...overrides,
	};
}

function board(rounds: AgentTeamRound[] = []): AgentTeamBoard {
	const next = newAgentTeam("s-round");
	next.rounds.push(...rounds);
	return next;
}

function call(tool: ReturnType<typeof createAgentTeamTool>, params: Record<string, unknown>) {
	const ctx = { sessionManager: { getSessionId: () => "s-round" } };
	return tool.execute("call-1", params as never, undefined, undefined, ctx as never);
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content[0]?.text ?? "";
}

beforeEach(() => {
	beginAgentTeamSession("s-round");
});

describe("round budget math", () => {
	it("defaults, caps, and rejects bad budgets", () => {
		assert.deepEqual(clampRoundBudget(), { tokens: 500_000, ms: 1_800_000 });
		assert.deepEqual(clampRoundBudget(0, 0), { tokens: 500_000, ms: 1_800_000 });
		assert.deepEqual(clampRoundBudget(10_000_000, 1_000), { tokens: 5_000_000, ms: 21_600_000 });
		assert.deepEqual(clampRoundBudget(12.9, 2.9), { tokens: 12, ms: 120_000 });
	});

	it("picks the lowest free round id and stops at five", () => {
		assert.equal(nextRoundId(board()), 1);
		assert.equal(nextRoundId(board([round(1), round(3)])), 2);
		assert.equal(nextRoundId(board([round(1), round(2), round(3), round(4), round(5)])), undefined);
	});

	it("sums only the tasks in the round", () => {
		const r = round(1, { taskIds: ["a", "b"] });
		assert.equal(
			roundSpentTokens(r, (id) => (id === "a" ? 10 : 20)),
			30,
		);
	});

	it("refuses the next round when the previous one is spent, unless forced", () => {
		const b = board([round(1)]);
		assert.equal(roundRefusal(b, 1_500, 50, false), undefined);
		assert.match(roundRefusal(b, 1_500, 100, false) ?? "", /used 100 of 100 tokens/);
		assert.equal(roundRefusal(b, 1_500, 100, true), undefined);
		assert.match(roundRefusal(b, 61_001, 50, false) ?? "", /ran 1 of 1 minutes/);
	});

	it("refuses a sixth round even with force", () => {
		const b = board([round(1), round(2), round(3), round(4), round(5)]);
		assert.match(roundRefusal(b, 1_500, 0, true) ?? "", /all 5 rounds/);
	});
});

describe("round tasks", () => {
	it("stores a valid round and refuses an out-of-range one", () => {
		const b = board();
		const ok = createAgentTeamTask(b, { subject: "one", description: "", round: 2 }, 10);
		assert.equal(ok.ok, true);
		if (ok.ok) assert.equal(ok.task.round, 2);
		const bad = createAgentTeamTask(b, { subject: "two", description: "", round: 6 }, 10);
		assert.equal(bad.ok, false);
		if (!bad.ok) assert.match(bad.error, /Round must be 1..5/);
	});
});

describe("round action", () => {
	it("keeps opening a round lead-only", async () => {
		const tool = createAgentTeamTool(
			{
				...agentTeamApi,
				round: async () => {
					throw new Error("must not run");
				},
			},
			"alice",
		);
		const denied = await call(tool, { action: "round", prompt: "ship it" });
		assert.equal(denied.isError, true);
		assert.match(text(denied), /Only the lead/);
	});

	it("needs a prompt and a wired round", async () => {
		const lead = createAgentTeamTool(agentTeamApi);
		const empty = await call(lead, { action: "round" });
		assert.equal(empty.isError, true);
		assert.match(text(empty), /round needs prompt/);
		const missing = await call(lead, { action: "round", prompt: "ship it" });
		assert.equal(missing.isError, true);
		assert.match(text(missing), /not available/);
	});

	it("returns the round, its budget, and its legs", async () => {
		const seen: unknown[] = [];
		const tool = createAgentTeamTool({
			...agentTeamApi,
			round: async (input) => {
				seen.push(input);
				return {
					ok: true,
					roundId: 2,
					agentTeamId: "s-round",
					runId: "run-x",
					tasks: [{ name: "worker", taskId: "task-1" }],
					started: 1,
					queued: 0,
					budget: { tokens: 500_000, ms: 1_800_000 },
				};
			},
		});
		const result = await call(tool, {
			action: "round",
			prompt: "ship it",
			roster: ["worker"],
			budget_tokens: 10,
			budget_minutes: 2,
			brief: "stay small",
			force: true,
		});
		assert.equal(result.isError, undefined);
		assert.deepEqual(seen, [
			{
				prompt: "ship it",
				roster: ["worker"],
				budgetTokens: 10,
				budgetMinutes: 2,
				brief: "stay small",
				force: true,
			},
		]);
		assert.match(text(result), /Round 2 · 1 started · 500000 tokens · 30 min/);
		assert.match(text(result), /worker — task-1/);
	});

	it("passes a refusal back unchanged", async () => {
		const tool = createAgentTeamTool({
			...agentTeamApi,
			round: async () => ({ ok: false, error: "Round 1 used all its tokens." }),
		});
		const result = await call(tool, { action: "round", prompt: "ship it" });
		assert.equal(result.isError, true);
		assert.match(text(result), /used all its tokens/);
	});
});
