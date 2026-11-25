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

describe("team state decoding", () => {
	it("keeps a valid board", () => {
		const agentTeam = decodeAgentTeam(valid);
		assert.ok(agentTeam);
		assert.equal(agentTeam.agentTeamId, "s-1");
		assert.equal(agentTeam.enabled, true);
		assert.equal(agentTeam.tasks.length, 1);
		assert.equal(agentTeam.tasks[0]?.owner, "worker");
		assert.equal(agentTeam.members[0]?.name, "worker");
	});

	it("rejects a missing or malformed team", () => {
		assert.equal(decodeAgentTeam(undefined), undefined);
		assert.equal(decodeAgentTeam({}), undefined);
		assert.equal(decodeAgentTeam({ agentTeamId: "" }), undefined);
		assert.equal(decodeAgentTeam([]), undefined);
	});

	it("drops malformed tasks and duplicate ids", () => {
		const agentTeam = decodeAgentTeam({
			...valid,
			tasks: [
				valid.tasks[0],
				{ ...valid.tasks[0] },
				{ ...valid.tasks[0], id: "task-2", revision: 0 },
				{ ...valid.tasks[0], id: "task-3", status: "weird" },
				{ ...valid.tasks[0], id: "task-4", createdAt: "yes" },
				{ ...valid.tasks[0], id: "nope" },
			],
		});
		assert.ok(agentTeam);
		assert.equal(agentTeam.tasks.length, 1);
		assert.equal(agentTeam.tasks[0]?.id, "task-1");
	});

	it("clamps text and lists", () => {
		const agentTeam = decodeAgentTeam({
			...valid,
			tasks: [
				{
					...valid.tasks[0],
					id: "task-1",
					subject: "s".repeat(500),
					description: "d".repeat(10_000),
					blockedBy: ["task-1", "task-1", 4],
					writeScopes: ["a", "a", "/etc"],
				},
			],
		});
		assert.ok(agentTeam);
		assert.equal(agentTeam.tasks[0]?.subject.length, 120);
		assert.equal(agentTeam.tasks[0]?.description.length, 2000);
		assert.deepEqual(agentTeam.tasks[0]?.blockedBy, ["task-1"]);
		assert.deepEqual(agentTeam.tasks[0]?.writeScopes, ["a"]);
	});

	it("canonicalizes persisted scopes and drops outside roots", () => {
		const agentTeam = decodeAgentTeam({
			...valid,
			tasks: [
				{
					...valid.tasks[0],
					writeScopes: ["src/./app", "src//app", "/etc", "../escape"],
				},
			],
		});
		assert.ok(agentTeam);
		assert.deepEqual(agentTeam.tasks[0]?.writeScopes, ["src/app"]);
	});

	it("bumps nextId above the highest surviving task", () => {
		const agentTeam = decodeAgentTeam({
			...valid,
			nextId: 1,
			tasks: [{ ...valid.tasks[0], id: "task-9" }],
		});
		assert.ok(agentTeam);
		assert.equal(agentTeam.nextId, 10);
	});

	it("keeps last-attempt fields and drops bad ones", () => {
		const agentTeam = decodeAgentTeam({
			...valid,
			tasks: [
				{ ...valid.tasks[0], lastOwner: "worker", lastError: "boom", returnedAt: 5 },
				{ ...valid.tasks[0], id: "task-2", lastOwner: 7, lastError: "", returnedAt: "x" },
			],
		});
		assert.ok(agentTeam);
		assert.equal(agentTeam.tasks[0]?.lastOwner, "worker");
		assert.equal(agentTeam.tasks[0]?.lastError, "boom");
		assert.equal(agentTeam.tasks[0]?.returnedAt, 5);
		assert.equal(agentTeam.tasks[1]?.lastOwner, undefined);
		assert.equal(agentTeam.tasks[1]?.lastError, undefined);
		assert.equal(agentTeam.tasks[1]?.returnedAt, undefined);
	});

	it("keeps the five newest attempts and drops bad rows", () => {
		const attempts = [
			...Array.from({ length: 7 }, (_, index) => ({
				at: index + 1,
				owner: "worker",
				outcome: index === 6 ? "passed" : "failed",
				...(index === 6 ? {} : { error: "try " + index }),
			})),
			{ at: "later", outcome: "failed" },
			{ at: 99, outcome: "unknown" },
		];
		const agentTeam = decodeAgentTeam({
			...valid,
			tasks: [{ ...valid.tasks[0], attempts }],
		});
		assert.ok(agentTeam);
		const kept = agentTeam.tasks[0]?.attempts ?? [];
		assert.equal(kept.length, 5);
		assert.equal(kept[0]?.at, 3);
		assert.equal(kept.at(-1)?.outcome, "passed");
		assert.equal(kept.at(-1)?.error, undefined);
	});

	it("keeps a bounded ledger and drops duplicates or bad rows", () => {
		const facts = Array.from({ length: 55 }, (_, index) => ({
			text: "fact " + index,
			kind: "fact",
			taskId: "task-1",
			by: "verifier",
			at: index,
		}));
		const agentTeam = decodeAgentTeam({
			...valid,
			tasks: [{ ...valid.tasks[0], attempts: [] }],
			ledger: [
				...facts,
				{ ...facts[54] },
				{ text: "no task", kind: "fact", taskId: "nope", by: "verifier", at: 1 },
				{ text: "bad kind", kind: "maybe", taskId: "task-1", by: "verifier", at: 1 },
				{
					text: "glob ignores dotfiles",
					kind: "excluded",
					taskId: "task-9",
					by: "verifier",
					at: 60,
				},
			],
		});
		assert.ok(agentTeam);
		const kept = agentTeam.ledger.filter((entry) => entry.kind === "fact");
		assert.equal(kept.length, 50);
		assert.equal(kept[0]?.text, "fact 5");
		assert.equal(agentTeam.ledger.at(-1)?.kind, "excluded");
	});

	it("keeps a member's run key and drops a bad one", () => {
		const agentTeam = decodeAgentTeam({
			...valid,
			members: [
				{ ...valid.members[0], key: "task-9" },
				{ name: "bob", starter: "worker", role: "worker", joinedAt: 2, key: 42 },
			],
		});
		assert.ok(agentTeam);
		assert.equal(agentTeam.members[0]?.key, "task-9");
		assert.equal(agentTeam.members[1]?.key, undefined);
	});

	it("dedupes members and requires true for enabled", () => {
		const agentTeam = decodeAgentTeam({
			...valid,
			enabled: "yes",
			members: [valid.members[0], { ...valid.members[0] }, { name: "x" }],
		});
		assert.ok(agentTeam);
		assert.equal(agentTeam.enabled, false);
		assert.equal(agentTeam.members.length, 1);
	});
});
