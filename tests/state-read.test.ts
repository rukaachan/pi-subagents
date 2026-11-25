import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	encodeState,
	loadState,
	MAX_STATE_BYTES,
	projectStatePath,
} from "../src/infra/state/index.ts";
import { findStateTask } from "../src/infra/state/index.ts";
import { rec, usage } from "./board-fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-state-read-"));

after(() => {
	rmSync(dir, { recursive: true, force: true });
});

function stateWith(tasks: unknown[]): string {
	return JSON.stringify({
		version: 1,
		savedAt: 0,
		tasks,
		ledger: {},
		pad: "x".repeat(MAX_STATE_BYTES),
	});
}

describe("state read bounds", () => {
	it("ignores a valid state file over the byte budget", () => {
		const file = join(dir, "oversized.json");
		writeFileSync(file, stateWith([]));
		assert.equal(loadState(file), null);
	});

	it("skips an oversized archive file", () => {
		const agentDir = join(dir, "agent");
		const file = projectStatePath(agentDir, "/repo");
		mkdirSync(dirname(file), { recursive: true });
		const task = rec({ taskId: "task-big", sessionId: "s1", cwd: "/repo", status: "done" });
		writeFileSync(file, stateWith([task]));
		assert.equal(findStateTask(agentDir, "/repo", "task-big"), undefined);
	});

	it("writes against bytes, not UTF-16 characters", () => {
		const tasks = Array.from({ length: 40 }, (_, i) =>
			rec({
				taskId: `task-${i}`,
				result: { text: "😀".repeat(60_000), usage: usage(1, 1, 0), notes: [] },
			}),
		);
		const json = encodeState({ version: 1, savedAt: 0, tasks, ledger: {} });
		assert.ok(Buffer.byteLength(json, "utf8") <= MAX_STATE_BYTES);
	});
});
