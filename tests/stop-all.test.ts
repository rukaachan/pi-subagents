/**
 * What a stop request leaves behind.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { RemovedIds, removedTaskMessage, unknownTaskMessage } from "../src/app/removed-ids.ts";
import { TaskStore } from "../src/app/task-store.ts";
import { InMemoryLedger } from "../src/app/ledger.ts";
import type { TaskRecord } from "../src/domain/task.ts";
import { stoppedRowNote } from "../src/domain/run-stop.ts";
import { stoppedSummary } from "../src/app/stop-all.ts";

function row(taskId: string, status: TaskRecord["status"] = "running"): TaskRecord {
	return {
		taskId,
		subagentName: "worker",
		description: "d",
		status,
		createdAt: 1,
		fullDelivered: false,
		cwd: "/tmp",
		history: [],
		kind: "background",
		subagent: {
			name: "worker",
			description: "d",
			model: "m",
			systemPrompt: "p",
			autonomy: "inherit",
			source: "user",
			filePath: "/tmp/worker.md",
			warnings: [],
		},
	};
}

describe("removing a stopped row", () => {
	it("takes the row off the board and keeps the rest", () => {
		const s = new TaskStore();
		s.add(row("t1"));
		s.add(row("t2"));
		assert.equal(s.remove("t1"), true);
		assert.deepEqual(
			s.list().map((r) => r.taskId),
			["t2"],
		);
		assert.equal(s.get("t1"), undefined);
		assert.equal(s.remove("t1"), false, "removing twice is not an error");
	});

	it("keeps the board order intact after a remove", () => {
		const s = new TaskStore();
		for (const id of ["a", "b", "c"]) s.add(row(id));
		s.remove("b");
		s.add(row("d"));
		assert.deepEqual(
			s.list().map((r) => r.taskId),
			["a", "c", "d"],
		);
	});
});

describe("the ledger after a stop", () => {
	it("books a stop, not a failure, and drops the live count", () => {
		const ledger = new InMemoryLedger();
		ledger.begin("worker");
		ledger.finish("worker", "stopped");
		const counts = ledger.bySubagent().worker;
		assert.equal(counts?.stopped, 1);
		assert.equal(counts?.error, 0, "a stop is not a failure");
		assert.equal(counts?.done, 0);
		assert.equal(counts?.running, 0, "the run is not live any more");
	});

	it("reads old files that never wrote a stopped key", () => {
		const ledger = new InMemoryLedger();
		ledger.restore({
			worker: {
				total: 3,
				running: 1,
				done: 2,
				error: 0,
				stopped: 0,
				foreground: 3,
				background: 0,
				alias: 0,
			},
		});
		assert.equal(ledger.bySubagent().worker?.stopped, 0);
	});
});

describe("an id that a stop removed", () => {
	it("is remembered, and answers with what happened", () => {
		const memory = new RemovedIds(3);
		memory.add("t1");
		assert.equal(memory.has("t1"), true);
		assert.match(unknownTaskMessage("t1", memory), /was stopped \(Esc, reload, or quit\)/);
	});

	it("is forgotten after the cap, and then reads as unknown again", () => {
		const memory = new RemovedIds(2);
		memory.add("t1");
		memory.add("t2");
		memory.add("t3");
		assert.equal(memory.has("t1"), false);
		assert.deepEqual(memory.all(), ["t2", "t3"]);
		assert.match(unknownTaskMessage("t1", memory), /may have expired/);
	});

	it("keeps one id once even when it is stopped twice", () => {
		const memory = new RemovedIds(5);
		memory.add("t1");
		memory.add("t1");
		assert.deepEqual(memory.all(), ["t1"]);
	});

	it("says the trigger in the row note", () => {
		assert.match(removedTaskMessage("x"), /removed/);
		assert.equal(stoppedRowNote("reload"), "interrupted by reload: the row was removed");
	});
});

describe("the notice an operator reads", () => {
	it("names what stopped and why", () => {
		assert.equal(
			stoppedSummary(["worker", "explorer"], "Esc"),
			"Stopped 2 subagents (Esc): worker, explorer.",
		);
	});

	it("counts the names it did not print", () => {
		const many = ["a", "b", "c", "d", "e", "f", "g", "h"];
		assert.match(
			stoppedSummary(many, "quit"),
			/^Stopped 8 subagents \(quit\): a, b, c, d, e, f and 2 more\.$/,
		);
	});

	it("says nothing when nothing was live", () => {
		assert.equal(stoppedSummary([], "Esc"), "");
	});
});

describe("the three doors that stop runs", () => {
	const source = readFileSync("extensions/index.ts", "utf8");

	it("watches Esc through the terminal listener, never a shortcut", () => {
		assert.doesNotMatch(source, /registerShortcut\("escape"/);
		assert.match(source, /watchEscapeKey\(ctx\.ui/);
		assert.match(source, /stopAllLiveRuns\("Esc"\)/);
	});

	it("catches an abort that did not come from the key", () => {
		assert.match(source, /on\("agent_settled"/);
		assert.match(source, /if \(event\.aborted\) stopAllLiveRuns/);
	});

	it("stops on reload and quit, and saves the board after", () => {
		assert.match(
			source,
			/if \(event\.reason === "reload" \|\| event\.reason === "quit"\) stopAllLiveRuns\(event\.reason\)/,
		);
		const body = source.slice(source.indexOf('on("session_shutdown"'));
		assert.ok(
			body.indexOf("stopAllLiveRuns") < body.indexOf("stopPersistence"),
			"rows must go before the file is written",
		);
	});
});
