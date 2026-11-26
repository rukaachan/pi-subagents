import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	beginAgentTeamSession,
	createTask,
	joinAgentTeam,
	updateTask,
} from "../src/app/agent-team/board/index.ts";
import { promoteTask } from "../src/app/agent-team/promote/index.ts";

function journal(): Record<string, unknown>[] {
	const file = join(dir, "journal.ndjson");
	if (!existsSync(file)) return [];
	const text = readFileSync(file, "utf8").trim();
	return text ? text.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) : [];
}

function finished(): void {
	const created = createTask({
		subject: "Cache audit",
		description: "Audit the cache layer",
		acceptance: "cache tests pass",
	});
	assert.ok(created.ok);
	joinAgentTeam("alice", "run-a");
	const claimed = updateTask(
		{ taskId: "task-1", expectedRevision: 1, action: "claim" },
		{ name: "alice", lead: false },
	);
	assert.ok(claimed.ok);
	const done = updateTask(
		{ taskId: "task-1", expectedRevision: 2, action: "complete", result: "Fixed the stale key." },
		{ name: "alice", lead: false },
	);
	assert.ok(done.ok);
	const verified = updateTask(
		{ taskId: "task-1", expectedRevision: 3, action: "verify", verdict: "pass" },
		{ name: "verifier", lead: false, role: "verifier" },
	);
	assert.ok(verified.ok);
}

let dir = "";
let previous: string | undefined;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-promote-run-"));
	previous = process.env.PI_SUBAGENTS_JOURNAL;
	process.env.PI_SUBAGENTS_JOURNAL = join(dir, "journal.ndjson");
	beginAgentTeamSession("s-promote-run");
});

afterEach(() => {
	if (previous === undefined) delete process.env.PI_SUBAGENTS_JOURNAL;
	else process.env.PI_SUBAGENTS_JOURNAL = previous;
	rmSync(dir, { recursive: true, force: true });
});

describe("promote action", () => {
	it("previews by default and journals the preview", () => {
		finished();
		const result = promoteTask("task-1", false);
		assert.ok(result.ok);
		if (!result.ok) return;
		assert.equal(result.written, false);
		assert.match(result.content, /name: cache-audit/);
		assert.equal(journal().at(-1)?.event, "agent_team_promote");
		assert.equal(journal().at(-1)?.written, false);
	});

	it("writes only with confirm and never overwrites", () => {
		finished();
		const first = promoteTask("task-1", true, join(dir, "agent"));
		assert.ok(first.ok);
		if (!first.ok) return;
		assert.equal(first.written, true);
		assert.ok(first.path && existsSync(first.path));
		const second = promoteTask("task-1", true, join(dir, "agent"));
		assert.ok(second.ok);
		if (!second.ok) return;
		assert.notEqual(second.path, first.path);
		assert.match(second.path ?? "", /cache-audit-2\.md$/);
	});

	it("refuses an unknown or unfinished task", () => {
		const missing = promoteTask("task-99", false);
		assert.equal(missing.ok, false);
		const created = createTask({ subject: "open", description: "" });
		assert.ok(created.ok);
		const open = promoteTask("task-1", false);
		assert.equal(open.ok, false);
		if (!open.ok) assert.match(open.error, /completed/);
	});
});
