import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeTeam } from "../src/infra/state-team.ts";

const valid = {
	teamId: "s-1",
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
	members: [{ name: "worker", starter: "worker", joinedAt: 1 }],
};

describe("team state decoding", () => {
	it("keeps a valid board", () => {
		const team = decodeTeam(valid);
		assert.ok(team);
		assert.equal(team.teamId, "s-1");
		assert.equal(team.enabled, true);
		assert.equal(team.tasks.length, 1);
		assert.equal(team.tasks[0]?.owner, "worker");
		assert.equal(team.members[0]?.name, "worker");
	});

	it("rejects a missing or malformed team", () => {
		assert.equal(decodeTeam(undefined), undefined);
		assert.equal(decodeTeam({}), undefined);
		assert.equal(decodeTeam({ teamId: "" }), undefined);
		assert.equal(decodeTeam([]), undefined);
	});

	it("drops malformed tasks and duplicate ids", () => {
		const team = decodeTeam({
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
		assert.ok(team);
		assert.equal(team.tasks.length, 1);
		assert.equal(team.tasks[0]?.id, "task-1");
	});

	it("clamps text and lists", () => {
		const team = decodeTeam({
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
		assert.ok(team);
		assert.equal(team.tasks[0]?.subject.length, 120);
		assert.equal(team.tasks[0]?.description.length, 2000);
		assert.deepEqual(team.tasks[0]?.blockedBy, ["task-1"]);
		assert.deepEqual(team.tasks[0]?.writeScopes, ["a", "/etc"]);
	});

	it("bumps nextId above the highest surviving task", () => {
		const team = decodeTeam({
			...valid,
			nextId: 1,
			tasks: [{ ...valid.tasks[0], id: "task-9" }],
		});
		assert.ok(team);
		assert.equal(team.nextId, 10);
	});

	it("keeps last-attempt fields and drops bad ones", () => {
		const team = decodeTeam({
			...valid,
			tasks: [
				{ ...valid.tasks[0], lastOwner: "worker", lastError: "boom", returnedAt: 5 },
				{ ...valid.tasks[0], id: "task-2", lastOwner: 7, lastError: "", returnedAt: "x" },
			],
		});
		assert.ok(team);
		assert.equal(team.tasks[0]?.lastOwner, "worker");
		assert.equal(team.tasks[0]?.lastError, "boom");
		assert.equal(team.tasks[0]?.returnedAt, 5);
		assert.equal(team.tasks[1]?.lastOwner, undefined);
		assert.equal(team.tasks[1]?.lastError, undefined);
		assert.equal(team.tasks[1]?.returnedAt, undefined);
	});

	it("keeps a member's run key and drops a bad one", () => {
		const team = decodeTeam({
			...valid,
			members: [
				{ ...valid.members[0], key: "task-9" },
				{ name: "bob", starter: "worker", joinedAt: 2, key: 42 },
			],
		});
		assert.ok(team);
		assert.equal(team.members[0]?.key, "task-9");
		assert.equal(team.members[1]?.key, undefined);
	});

	it("dedupes members and requires true for enabled", () => {
		const team = decodeTeam({
			...valid,
			enabled: "yes",
			members: [valid.members[0], { ...valid.members[0] }, { name: "x" }],
		});
		assert.ok(team);
		assert.equal(team.enabled, false);
		assert.equal(team.members.length, 1);
	});
});
