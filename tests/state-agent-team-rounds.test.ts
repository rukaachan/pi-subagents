import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeAgentTeam } from "../src/infra/state/index.ts";

const valid = {
	agentTeamId: "s-1",
	enabled: true,
	nextId: 3,
	tasks: [
		{
			id: "task-1",
			revision: 2,
			subject: "Fix parser",
			description: "detail",
			status: "in_progress",
			owner: "worker",
			blockedBy: [],
			writeScopes: ["src/app"],
			createdAt: 1,
			updatedAt: 2,
		},
	],
	members: [{ name: "worker", starter: "worker", role: "worker", joinedAt: 1 }],
};

const task = (extra: Record<string, unknown>) => ({ ...valid.tasks[0], ...extra });

describe("team state: rounds and new task fields", () => {
	it("keeps round, cross-verify, isolation, and worktree fields", () => {
		const agentTeam = decodeAgentTeam({
			...valid,
			tasks: [
				task({
					round: 2,
					crossVerify: true,
					crossVerdict: "pass",
					crossVerifiedBy: "verifier",
					crossVerifiedAt: 7,
					crossVerifyRunId: "run-1",
					isolation: "worktree",
					worktree: { path: "/tmp/wt", base: "/repo", createdAt: 3, mergedAt: 4 },
				}),
			],
		});
		assert.ok(agentTeam);
		const kept = agentTeam.tasks[0];
		assert.equal(kept?.round, 2);
		assert.equal(kept?.crossVerify, true);
		assert.equal(kept?.crossVerdict, "pass");
		assert.equal(kept?.crossVerifiedBy, "verifier");
		assert.equal(kept?.crossVerifiedAt, 7);
		assert.equal(kept?.crossVerifyRunId, "run-1");
		assert.equal(kept?.isolation, "worktree");
		assert.deepEqual(kept?.worktree, {
			path: "/tmp/wt",
			base: "/repo",
			createdAt: 3,
			mergedAt: 4,
		});
	});

	it("drops bad new task fields and caps the worktree path", () => {
		const agentTeam = decodeAgentTeam({
			...valid,
			tasks: [
				task({
					round: 0,
					crossVerify: "yes",
					crossVerdict: "maybe",
					crossVerifiedBy: "",
					crossVerifiedAt: "later",
					crossVerifyRunId: 4,
					isolation: "nope",
					worktree: { path: "", base: 1, createdAt: "x" },
				}),
				task({
					id: "task-2",
					worktree: {
						path: "/tmp/" + "p".repeat(600),
						base: "/repo",
						createdAt: 3,
					},
				}),
			],
		});
		assert.ok(agentTeam);
		const bad = agentTeam.tasks[0];
		assert.equal(bad?.round, undefined);
		assert.equal(bad?.crossVerify, undefined);
		assert.equal(bad?.crossVerdict, undefined);
		assert.equal(bad?.crossVerifiedBy, undefined);
		assert.equal(bad?.crossVerifiedAt, undefined);
		assert.equal(bad?.crossVerifyRunId, undefined);
		assert.equal(bad?.isolation, undefined);
		assert.equal(bad?.worktree, undefined);
		assert.equal(agentTeam.tasks[1]?.worktree?.path.length, 512);
	});

	it("keeps at most five rounds and caps their fields", () => {
		const rounds = Array.from({ length: 6 }, (_, index) => ({
			id: index + 1,
			prompt: "prompt " + (index + 1),
			taskIds: ["task-1", "task-1", "task-2"],
			brief: "b".repeat(3_000),
			budget: { tokens: 10, ms: 20 },
			startedAt: index + 1,
		}));
		const agentTeam = decodeAgentTeam({
			...valid,
			rounds: [...rounds, { ...rounds[0] }, { id: 9, prompt: "too high" }],
		});
		assert.ok(agentTeam);
		assert.equal(agentTeam.rounds.length, 5);
		assert.equal(agentTeam.rounds[0]?.id, 1);
		assert.equal(agentTeam.rounds.at(-1)?.id, 5);
		assert.equal(agentTeam.rounds[0]?.brief?.length, 2_000);
		assert.deepEqual(agentTeam.rounds[0]?.taskIds, ["task-1", "task-2"]);
		assert.deepEqual(agentTeam.rounds[0]?.budget, { tokens: 10, ms: 20 });
	});
});
