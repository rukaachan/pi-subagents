import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	beginAgentTeamSession,
	createTask,
	joinAgentTeam,
	updateTask,
} from "../src/app/agent-team/board/index.ts";
import { startAgentTeamCrossVerification } from "../src/app/agent-team/cross-run/index.ts";
import { pick } from "../src/app/agent-team/verify-run/index.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

let dir = "";
let previous: string | undefined;

function journal(): Record<string, unknown>[] {
	const text = readFileSync(join(dir, "journal.ndjson"), "utf8").trim();
	return text ? text.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) : [];
}

function inReview(): void {
	const created = createTask({
		subject: "one",
		description: "",
		acceptance: "tests pass",
		crossVerify: true,
	});
	assert.ok(created.ok);
	joinAgentTeam("alice", "run-a");
	const claimed = updateTask(
		{ taskId: "task-1", expectedRevision: 1, action: "claim" },
		{ name: "alice", lead: false },
	);
	assert.ok(claimed.ok);
	const done = updateTask(
		{ taskId: "task-1", expectedRevision: 2, action: "complete", result: "done" },
		{ name: "alice", lead: false },
	);
	assert.ok(done.ok);
	assert.equal(done.task.status, "in_review");
	const verified = updateTask(
		{ taskId: "task-1", expectedRevision: 3, action: "verify", verdict: "pass" },
		{ name: "verifier", lead: false, role: "verifier" },
	);
	assert.ok(verified.ok);
	assert.equal(verified.task.verdict, "pass");
	assert.equal(verified.task.status, "in_review");
}

function ctx(cwd: string): ExtensionContext {
	return { cwd, ui: { setStatus: () => {} } } as unknown as ExtensionContext;
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-cross-launch-"));
	previous = process.env.PI_SUBAGENTS_JOURNAL;
	process.env.PI_SUBAGENTS_JOURNAL = join(dir, "journal.ndjson");
	beginAgentTeamSession("s-cross-launch");
});

afterEach(() => {
	if (previous === undefined) delete process.env.PI_SUBAGENTS_JOURNAL;
	else process.env.PI_SUBAGENTS_JOURNAL = previous;
	rmSync(dir, { recursive: true, force: true });
});

describe("cross verifier launch", () => {
	it("refuses when agent team mode is off", () => {
		inReview();
		startAgentTeamCrossVerification({} as never, "task-1", ctx(dir), {} as never);
		const line = journal().at(-1);
		assert.equal(line?.event, "agent_team_verify");
		assert.equal(line?.scope, "cross");
		assert.equal(line?.ok, false);
		assert.match(String(line?.error), /team is off/);
	});

	it("has no verifier when the roster is empty", () => {
		assert.equal(pick(undefined, []), undefined);
	});
});
