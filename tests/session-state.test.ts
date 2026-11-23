/**
 * Two Pi sessions in one repo never overwrite each other's rows.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginSession, store, stopPersistence } from "../src/app/live-store.ts";
import { archivedTask } from "../src/app/persist.ts";
import { rec } from "./board-fixtures.ts";

const home = process.env.HOME;
const dir = mkdtempSync(join(tmpdir(), "pi-session-state-"));

function done(taskId: string, sessionId: string) {
	return rec({ taskId, sessionId, cwd: "/repo", status: "done", createdAt: 1_000 });
}

after(() => {
	stopPersistence();
	process.env.HOME = home;
	rmSync(dir, { recursive: true, force: true });
});

describe("session-scoped state", () => {
	it("keeps each session's rows out of the other's file", () => {
		process.env.HOME = dir;
		beginSession("/repo", "s1");
		store.add(done("task-a", "s1"));
		stopPersistence();

		beginSession("/repo", "s2");
		assert.deepEqual(
			store.list().map((row) => row.taskId),
			[],
		);
		store.add(done("task-b", "s2"));
		stopPersistence();

		beginSession("/repo", "s1");
		assert.deepEqual(
			store.list().map((row) => row.taskId),
			["task-a"],
		);
		stopPersistence();
	});

	it("resumes a done row from an older session by id", () => {
		process.env.HOME = dir;
		beginSession("/repo", "s1");
		store.add(
			rec({
				taskId: "task-old",
				sessionId: "s1",
				cwd: "/repo",
				status: "done",
				createdAt: 1_000,
				endedAt: 9_000,
				history: [{ timestamp: 8_000, role: "assistant", content: "hi" }],
				result: {
					text: "the old report",
					usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
					notes: [],
				},
			}),
		);
		stopPersistence();

		beginSession("/repo", "s2");
		assert.equal(store.get("task-old"), undefined);
		const found = archivedTask("/repo", "task-old");
		assert.equal(found?.status, "done");
		assert.equal(found?.history.length, 1);
		assert.equal(found?.result?.text, "the old report");
		assert.equal(archivedTask("/other-repo", "task-old"), undefined);
		stopPersistence();
	});

	it("freezes an archived row that was still running", () => {
		process.env.HOME = dir;
		beginSession("/repo", "s-live");
		store.add(
			rec({
				taskId: "task-cut",
				sessionId: "s-live",
				cwd: "/repo",
				status: "running",
				createdAt: 1_000,
				startedAt: 2_000,
				history: [{ timestamp: 7_500 }],
			}),
		);
		stopPersistence();
		const found = archivedTask("/repo", "task-cut");
		assert.equal(found?.status, "error");
		assert.equal(found?.endedAt, 7_500);
		assert.match(found?.error ?? "", /Interrupted by Pi restart/);
	});

	it("pins an explicit state file for tests and e2e", () => {
		const pinned = join(dir, "pinned.json");
		process.env.PI_SUBAGENTS_STATE = pinned;
		try {
			beginSession("/repo", "s1");
			store.add(done("task-pin", "s1"));
			stopPersistence();
			beginSession("/repo", "s9");
			assert.deepEqual(
				store.list().map((row) => row.taskId),
				["task-pin"],
			);
			stopPersistence();
		} finally {
			delete process.env.PI_SUBAGENTS_STATE;
		}
	});
});
