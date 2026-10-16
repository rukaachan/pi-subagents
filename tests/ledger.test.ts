import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryLedger } from "../src/app/ledger.ts";
import { spawnSummary } from "../src/ui/view/rows.ts";
import { subagentDetail } from "../src/ui/view/detail.ts";
import type { SubagentConfig } from "../src/domain/subagent/config.ts";

function sub(): SubagentConfig {
	return {
		name: "explorer",
		description: "d",
		model: "inherit",
		tools: undefined,
		autonomy: "low",
		thinkingLevel: undefined,
		systemPrompt: "x",
		filePath: "/tmp/explorer.md",
		source: "user",
		warnings: [],
	};
}

describe("ledger", () => {
	it("counts begins and finishes per subagent", () => {
		const l = new InMemoryLedger();
		l.begin("explorer");
		l.begin("explorer");
		l.begin("worker");
		l.finish("explorer", "done");
		l.finish("explorer", "error");
		l.finish("worker", "done");
		assert.equal(l.total("explorer"), 2);
		assert.equal(l.total(), 3);
		assert.equal(l.total("missing"), 0);
		const by = l.bySubagent();
		assert.deepEqual(by.explorer, {
			total: 2,
			running: 0,
			done: 1,
			error: 1,
			stopped: 0,
			foreground: 0,
			background: 0,
			alias: 0,
		});
		const worker = by.worker;
		assert.ok(worker, "worker counted");
		assert.equal(worker.running, 0);
	});

	it("running drops on finish, never below zero", () => {
		const l = new InMemoryLedger();
		l.finish("ghost", "done");
		const ghost = l.bySubagent().ghost;
		assert.ok(ghost, "finish from nothing creates a row");
		assert.equal(ghost.running, 0);
		assert.equal(ghost.done, 1);
	});

	it("bumps kinds", () => {
		const l = new InMemoryLedger();
		l.begin("w");
		l.bumpKind("w", "foreground");
		l.bumpKind("w", "alias");
		const w = l.bySubagent().w;
		assert.ok(w, "w counted");
		assert.equal(w.foreground, 1);
		assert.equal(w.alias, 1);
		assert.equal(w.background, 0);
	});
});

describe("spawn views", () => {
	it("summary shows totals and live names", () => {
		const text = spawnSummary({
			explorer: {
				total: 2,
				running: 1,
				done: 1,
				error: 0,
				stopped: 0,
				foreground: 1,
				background: 1,
				alias: 0,
			},
		});
		assert.ok(text.includes("2 runs"));
		assert.ok(text.includes("explorer×1"));
	});

	it("empty summary says none", () => {
		assert.ok(spawnSummary({}).includes("no runs yet"));
	});

	it("detail shows spawns when given", () => {
		const d = subagentDetail(sub(), { total: 3, running: 0, done: 3, error: 0 });
		assert.ok(d.includes("3 total"));
		const bare = subagentDetail(sub());
		assert.ok(!bare.includes("runs"));
	});
});
