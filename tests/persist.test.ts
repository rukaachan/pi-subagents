import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	capRecord,
	decodeState,
	encodeState,
	defaultStatePath,
	loadState,
	saveState,
	MAX_HISTORY_MESSAGES,
	MAX_RESULT_CHARS,
	STATE_FILE_NAME,
	STATE_VERSION,
	type PersistedState,
} from "../src/infra/state-file.ts";
import { restoreInto, serializeState } from "../src/app/persist.ts";
import { InMemoryLedger } from "../src/app/ledger.ts";
import { TaskStore } from "../src/app/task-store.ts";
import { newTaskId, type TaskRecord } from "../src/app/task-record.ts";
import type { SubagentConfig } from "../src/domain/subagent/config.ts";

function sub(over: Partial<SubagentConfig> = {}): SubagentConfig {
	return {
		name: "explorer",
		description: "d",
		model: "inherit",
		autonomy: "low",
		systemPrompt: "p",
		source: "user",
		filePath: "/tmp/x.md",
		warnings: [],
		...over,
	};
}

function rec(over: Partial<TaskRecord> = {}): TaskRecord {
	return {
		taskId: newTaskId(),
		subagentName: "explorer",
		description: "label",
		status: "running",
		createdAt: Date.now(),
		fullDelivered: false,
		subagent: sub(),
		cwd: "/tmp",
		history: [],
		...over,
	};
}

function doneRec(over: Partial<TaskRecord> = {}): TaskRecord {
	return rec({
		status: "done",
		result: {
			text: "report body",
			usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
			notes: [],
		},
		...over,
	});
}

describe("persist", () => {
	it("round-trips state through encode/decode", () => {
		const store = new TaskStore();
		const ledger = new InMemoryLedger();
		const r = doneRec();
		store.add(r);
		ledger.begin("explorer");
		ledger.finish("explorer", "done");

		const json = encodeState(serializeState(store, ledger));
		const back = decodeState(json);
		assert.ok(back);
		assert.equal(back.version, STATE_VERSION);
		assert.equal(back.tasks.length, 1);
		const first = back.tasks[0];
		assert.ok(first, "one task round-trips");
		assert.equal(first.taskId, r.taskId);
		assert.equal(back.ledger.explorer?.total, 1);
		assert.equal(back.ledger.explorer?.done, 1);
	});

	it("rejects wrong version and garbage", () => {
		assert.equal(decodeState("nope"), null);
		assert.equal(decodeState("{}"), null);
		assert.equal(decodeState(JSON.stringify({ version: 99, tasks: [], ledger: {} })), null);
	});

	it("marks live rows as interrupted on restore", () => {
		const store = new TaskStore();
		const live = rec({ status: "running" });
		const done = doneRec();
		store.restore([live, done]);
		const back = store.get(live.taskId);
		assert.equal(back?.status, "error");
		assert.match(back?.error ?? "", /Interrupted/);
		assert.equal(store.get(done.taskId)?.status, "done");
	});

	it("marks running chain steps as interrupted too", () => {
		const store = new TaskStore();
		const chain = rec({
			kind: "chain",
			status: "running",
			steps: [
				{ idx: 0, subagentName: "explorer", prompt: "p", status: "running" },
				{ idx: 1, subagentName: "worker", prompt: "p", status: "pending" },
			],
		});
		store.restore([chain]);
		const steps = store.get(chain.taskId)?.steps ?? [];
		const [step0, step1] = steps;
		assert.ok(step0 && step1, "both steps restored");
		assert.equal(step0.status, "error");
		assert.match(step0.error ?? "", /Interrupted/);
		assert.equal(step1.status, "pending");
	});

	it("keeps the nameless-dispatch provenance through encode + decode", () => {
		const store = new TaskStore();
		const ledger = new InMemoryLedger();
		store.add(rec({ dispatch: { rule: "review", matched: "review" } }));
		const raw = encodeState(serializeState(store, ledger));
		const restored = decodeState(raw);
		assert.ok(restored, "state decodes");
		assert.deepEqual(restored.tasks[0]?.dispatch, { rule: "review", matched: "review" });
	});

	it("counts interrupted runs as errors on restoreInto", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-state-"));
		const file = path.join(dir, STATE_FILE_NAME);
		const src = new TaskStore();
		const srcLedger = new InMemoryLedger();
		src.add(rec({ taskId: "task-live" }));
		srcLedger.begin("explorer");
		saveState(file, encodeState(serializeState(src, srcLedger)));

		const store = new TaskStore();
		const ledger = new InMemoryLedger();
		restoreInto(store, ledger, file);
		const row = ledger.bySubagent().explorer;
		assert.ok(row, "interrupted count restored");
		assert.equal(row.running, 0);
		assert.equal(row.total, 1);
		assert.equal(row.error, 1);

		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("caps history and result text", () => {
		const big = doneRec({
			history: Array.from({ length: MAX_HISTORY_MESSAGES + 20 }, (_, i) => ({ i })),
			result: {
				text: "x".repeat(MAX_RESULT_CHARS + 100),
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
				notes: [],
			},
		});
		const capped = capRecord(big);
		assert.equal(capped.history.length, MAX_HISTORY_MESSAGES);
		assert.ok(capped.result);
		assert.ok(capped.result.text.length < MAX_RESULT_CHARS + 100);
		assert.match(capped.result.text, /cut on save/);
	});

	it("drops oldest rows to fit the byte cap", () => {
		const store = new TaskStore();
		for (let i = 0; i < 40; i++) {
			store.add(
				doneRec({
					taskId: `task-${i}`,
					result: {
						text: "y".repeat(80_000),
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
						notes: [],
					},
				}),
			);
		}
		const json = encodeState(serializeState(store, new InMemoryLedger()));
		const back = decodeState(json);
		assert.ok(back);
		assert.ok(back.tasks.length < 40);
		const last = back.tasks[back.tasks.length - 1];
		assert.ok(last, "rows were dropped, the newest survives");
		assert.equal(last.taskId, "task-39");
	});

	it("saves and loads from disk, missing file is null", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-state-"));
		const file = path.join(dir, "nested", STATE_FILE_NAME);
		assert.equal(loadState(file), null);

		const store = new TaskStore();
		store.add(doneRec());
		const json = encodeState(serializeState(store, new InMemoryLedger()));
		const w = saveState(file, json);
		assert.equal(w.error, undefined);
		assert.ok(fs.existsSync(file));

		const back = loadState(file);
		assert.ok(back);
		assert.equal(back.tasks.length, 1);

		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("restoreInto fills store and ledger", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-state-"));
		const file = path.join(dir, STATE_FILE_NAME);
		const src = new TaskStore();
		const srcLedger = new InMemoryLedger();
		src.add(doneRec({ taskId: "task-keep" }));
		srcLedger.begin("worker");
		srcLedger.finish("worker", "error");
		saveState(file, encodeState(serializeState(src, srcLedger)));

		const store = new TaskStore();
		const ledger = new InMemoryLedger();
		const n = restoreInto(store, ledger, file);
		assert.equal(n, 1);
		assert.ok(store.get("task-keep"));
		assert.equal(ledger.bySubagent().worker?.error, 1);

		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("default path sits under the agent dir", () => {
		assert.equal(defaultStatePath("/tmp/agent"), path.join("/tmp/agent", STATE_FILE_NAME));
		assert.ok(defaultStatePath().endsWith(STATE_FILE_NAME));
	});

	it("encode always yields parseable json", () => {
		const state: PersistedState = {
			version: STATE_VERSION,
			savedAt: 1,
			tasks: [],
			ledger: {},
		};
		assert.deepEqual(decodeState(encodeState(state))?.tasks, []);
	});
});
