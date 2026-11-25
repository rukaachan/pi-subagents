import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HYBRID_POLICY } from "../src/domain/policy/index.ts";
import { DELEGATION_RULE, AGENT_TEAM_LEAD_POLICY } from "../src/domain/policy/index.ts";

describe("hybrid policy", () => {
	it("orders the ladder from local to team start", () => {
		const order = ["Local:", "Basic:", "Delegate:", "Team:"].map((word) =>
			HYBRID_POLICY.indexOf(word),
		);
		for (const index of order) assert.ok(index >= 0, "every rung is named");
		assert.deepEqual(
			order,
			[...order].toSorted((a, b) => a - b),
		);
		assert.match(HYBRID_POLICY, /Team \{ action: "start", prompt/);
		assert.doesNotMatch(HYBRID_POLICY, /action: "launch"/);
		assert.doesNotMatch(HYBRID_POLICY, /\/team on/);
	});

	it("keeps the one-line Task rule small and on the same ladder", () => {
		assert.ok(!DELEGATION_RULE.includes("\n"));
		assert.ok(DELEGATION_RULE.length < 400);
		assert.match(DELEGATION_RULE, /smallest level/);
		assert.match(DELEGATION_RULE, /Team start/);
		assert.match(DELEGATION_RULE, /one task and one worker per leg|broad fan-out/);
	});

	it("tells the lead how to fan out once the board is on", () => {
		assert.match(AGENT_TEAM_LEAD_POLICY, /Team \{ action: "start", prompt/);
		assert.match(AGENT_TEAM_LEAD_POLICY, /one task and one worker per leg/);
	});
});
