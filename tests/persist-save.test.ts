import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { InMemoryLedger } from "../src/app/ledger.ts";
import { attachPersistence, SAVE_DEBOUNCE_MS } from "../src/app/persist.ts";
import { newTaskId, type TaskRecord } from "../src/app/task-record.ts";
import { TaskStore } from "../src/app/task-store.ts";
import type { SubagentConfig } from "../src/domain/subagent/config.ts";
import {
	capRecord,
	loadState,
	MAX_HISTORY_CHARS,
	STATE_FILE_NAME,
} from "../src/infra/state-file.ts";

function sub(): SubagentConfig {
	return {
		name: "explorer",
		description: "d",
		model: "inherit",
		autonomy: "low",
		systemPrompt: "p",
		source: "user",
		filePath: "/tmp/x.md",
		warnings: [],
	};
}

function doneRec(over: Partial<TaskRecord> = {}): TaskRecord {
	return {
		taskId: newTaskId(),
		subagentName: "explorer",
		description: "label",
		status: "done",
		createdAt: Date.now(),
		fullDelivered: false,
		subagent: sub(),
		cwd: "/tmp",
		history: [],
		result: {
			text: "report body",
			usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
			notes: [],
		},
		...over,
	};
}

describe("state size and save", () => {
	it("caps history by bytes, keeping the newest message", () => {
		const history = Array.from({ length: 40 }, (_, i) => ({
			role: "tool",
			text: "x".repeat(2_000),
			i,
		}));
		const capped = capRecord(doneRec({ history: history as never }));
		assert.ok(capped.history.length < 40);
		assert.equal((capped.history.at(-1) as unknown as { i: number }).i, 39);
		assert.ok(JSON.stringify(capped.history).length < MAX_HISTORY_CHARS + 40);
	});

	it("persists on a debounce and flushes on stop", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-state-"));
		const file = path.join(dir, STATE_FILE_NAME);
		const store = new TaskStore();
		const ledger = new InMemoryLedger();
		const stop = attachPersistence(store, ledger, file);
		try {
			store.add(doneRec({ taskId: "task-async" }));
			await new Promise((resolve) => {
				setTimeout(resolve, SAVE_DEBOUNCE_MS + 350);
			});
			assert.ok(fs.existsSync(file), "debounced write lands");
			assert.equal(loadState(file)?.tasks[0]?.taskId, "task-async");
			store.add(doneRec({ taskId: "task-flush" }));
			stop();
			assert.ok(loadState(file)?.tasks.some((task) => task.taskId === "task-flush"));
		} finally {
			stop();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
