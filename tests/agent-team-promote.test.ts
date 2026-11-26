import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MAX_AGENT_TEAM_PROMOTE,
	newAgentTeam,
	type AgentTeamBoard,
	type AgentTeamTask,
} from "../src/domain/agent-team/index.ts";
import { buildPromoteDraft } from "../src/domain/agent-team/lifecycle/index.ts";
import { draftsDir, writeSubagentDraft } from "../src/infra/files/index.ts";
import { loadSubagentsFromDir } from "../src/infra/files/index.ts";

function task(over: Partial<AgentTeamTask> = {}): AgentTeamTask {
	return {
		id: "task-1",
		revision: 3,
		subject: "Cache audit",
		description: "Audit the cache layer",
		status: "completed",
		blockedBy: [],
		writeScopes: ["src/cache"],
		acceptance: "cache tests pass",
		verdict: "pass",
		verifiedBy: "tester",
		result: "Found the stale key and fixed it.",
		attempts: [
			{ at: 1, outcome: "failed", method: "tried a global lock" },
			{ at: 2, outcome: "passed", method: "bounded the cache", round: 2 },
		],
		createdAt: 1,
		updatedAt: 2,
		...over,
	};
}

function board(taskRow: AgentTeamTask): AgentTeamBoard {
	return {
		...newAgentTeam("s-promote"),
		tasks: [taskRow],
		ledger: [
			{ text: "global lock deadlocks", kind: "excluded", taskId: taskRow.id, by: "a", at: 1 },
			{ text: "another task", kind: "excluded", taskId: "task-2", by: "a", at: 1 },
		],
	};
}

let dir = "";

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-promote-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("promote builder", () => {
	it("builds a read-only draft with steps, acceptance, dead ends, and proof", () => {
		const row = task();
		const built = buildPromoteDraft(row, board(row));
		assert.ok(built.ok);
		assert.equal(built.draft.name, "cache-audit");
		assert.match(built.draft.content, /name: cache-audit/);
		assert.match(built.draft.content, /tools: read, grep, find, ls/);
		assert.match(built.draft.content, /Acceptance/);
		assert.match(built.draft.content, /cache tests pass/);
		assert.match(built.draft.content, /global lock deadlocks/);
		assert.doesNotMatch(built.draft.content, /another task/);
		assert.match(built.draft.content, /Proof/);
		assert.match(built.draft.content, /Found the stale key/);
		assert.match(built.draft.content, /round 2/);
	});

	it("caps the draft", () => {
		const row = task({ result: "x".repeat(8_000) });
		const built = buildPromoteDraft(row, board(row));
		assert.ok(built.ok);
		assert.ok(built.draft.content.length <= MAX_AGENT_TEAM_PROMOTE);
	});

	it("refuses an unfinished, unverified, or cross-failed task", () => {
		const open = task({ status: "in_progress" });
		assert.equal(buildPromoteDraft(open, board(open)).ok, false);
		const unverified = task({ verdict: undefined });
		assert.equal(buildPromoteDraft(unverified, board(unverified)).ok, false);
		const cross = task({ crossVerify: true, crossVerdict: "fail" });
		const refused = buildPromoteDraft(cross, board(cross));
		assert.equal(refused.ok, false);
		if (!refused.ok) assert.match(refused.error, /cross verifier/);
	});
});

describe("promote writer", () => {
	it("writes a new draft and never overwrites it", () => {
		const first = writeSubagentDraft("cache-audit", "one", dir);
		assert.ok(first.ok);
		assert.equal(readFileSync(first.path, "utf8"), "one");
		const second = writeSubagentDraft("cache-audit", "two", dir);
		assert.ok(second.ok);
		assert.notEqual(second.path, first.path);
		assert.match(second.path, /cache-audit-2\.md$/);
		assert.equal(readFileSync(first.path, "utf8"), "one");
	});

	it("keeps drafts out of normal discovery", () => {
		const subagents = join(dir, "subagents");
		mkdirSync(join(subagents, "drafts"), { recursive: true });
		writeFileSync(join(subagents, "drafts", "draft.md"), "draft");
		const errors: string[] = [];
		const found = loadSubagentsFromDir(subagents, "user", errors);
		assert.deepEqual(found, []);
		assert.equal(draftsDir(dir), join(subagents, "drafts"));
	});

	it("refuses a traversal-shaped name", () => {
		const bad = writeSubagentDraft("../escape", "x", dir);
		assert.equal(bad.ok, false);
	});
});
