/**
 * Journal unit tests: pure fold logic and the env switch.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { foldJournal, journalWrite, STALE_AFTER_MS } from "../src/telemetry/journal.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-journal-unit-"));
const path = join(dir, "j.ndjson");
process.env.PI_SUBAGENTS_JOURNAL = path;

after(() => {
	delete process.env.PI_SUBAGENTS_JOURNAL;
	rmSync(dir, { recursive: true, force: true });
});

describe("silence metrics (the stall floor's evidence)", () => {
	it("folds gapMaxSec and gapOver60 from run_end", () => {
		const lines = [
			JSON.stringify({ ts: 1, event: "run_start", id: "g", label: "worker", kind: "background" }),
			JSON.stringify({
				ts: 900,
				event: "run_end",
				id: "g",
				status: "done",
				turns: 4,
				elapsedSec: 900,
				gapMaxSec: 391,
				gapOver60: 2,
			}),
		];
		const [run] = foldJournal(lines);
		assert.ok(run);
		assert.equal(run.gapMaxSec, 391);
		assert.equal(run.gapOver60, 2);
	});

	it("leaves older runs without the field undefined, not zero", () => {
		// A zero would read as "no silence" and poison the fit; absent data
		// must stay absent so the script can report coverage.
		const lines = [
			JSON.stringify({ ts: 1, event: "run_start", id: "old", label: "worker", kind: "foreground" }),
			JSON.stringify({
				ts: 60,
				event: "run_end",
				id: "old",
				status: "done",
				turns: 1,
				elapsedSec: 60,
			}),
		];
		const [run] = foldJournal(lines);
		assert.ok(run);
		assert.equal(run.gapMaxSec, undefined);
		assert.equal(run.gapOver60, undefined);
	});
});

describe("journal fold", () => {
	it("folds a full run: start → turn → tool → end", () => {
		const lines = [
			JSON.stringify({ ts: 10, event: "run_start", id: "a", label: "explorer", kind: "parallel" }),
			JSON.stringify({ ts: 11, event: "turn", id: "a", turns: 1 }),
			JSON.stringify({ ts: 12, event: "tool", id: "a", tool: "codemode", turns: 1 }),
			JSON.stringify({
				ts: 20,
				event: "run_end",
				id: "a",
				status: "done",
				turns: 3,
				elapsedSec: 42,
				reportChars: 500,
				model: "m1",
				notes: ["turn budget 20 reached: run stopped early."],
			}),
		];
		const [run] = foldJournal(lines);
		assert.ok(run);
		assert.equal(run.status, "done");
		assert.equal(run.turns, 3, "end row wins over interim turns");
		assert.equal(run.tool, "codemode");
		assert.equal(run.elapsedSec, 42);
		assert.equal(run.reportChars, 500);
		assert.equal(run.model, "m1");
		assert.match((run.notes ?? []).join(" "), /turn budget/);
	});

	it("skips torn and unknown lines; keeps error rows", () => {
		const lines = [
			'{"ts":1,"event":"run_start","id":"b","label":"worker","kind":"foreground"}',
			'{"ts":2,"event":"tu', // torn write
			"not json at all",
			'{"ts":3,"event":"mystery","id":"b"}',
			JSON.stringify({
				ts: 4,
				event: "run_end",
				id: "b",
				status: "error",
				turns: 1,
				elapsedSec: 1,
				error: "boom",
			}),
		];
		const [run] = foldJournal(lines);
		assert.ok(run);
		assert.equal(run.status, "error");
		assert.equal(run.error, "boom");
	});

	it("folds a run a stop request ended as interrupted", () => {
		const lines = [
			JSON.stringify({ ts: 1, event: "run_start", id: "s", label: "worker", kind: "background" }),
			JSON.stringify({
				ts: 6,
				event: "run_end",
				id: "s",
				status: "interrupted",
				turns: 1,
				elapsedSec: 5,
				error: "interrupted by Esc: the row was removed",
			}),
		];
		const [run] = foldJournal(lines);
		assert.equal(run?.status, "interrupted");
		assert.match(run?.error ?? "", /interrupted by Esc/);
		assert.equal(run?.stale, undefined, "a stopped run is finished, not stale");
	});

	it("journalWrite appends real NDJSON to the configured path", () => {
		journalWrite({ event: "run_start", id: "c", label: "lbl", kind: "chain" });
		journalWrite({ event: "turn", id: "c", turns: 1 });
		const text = readFileSync(path, "utf8");
		const parsed = text
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l) as { event: string; id: string });
		assert.deepEqual(
			parsed.map((e) => e.event),
			["run_start", "turn"],
		);
	});

	it("journalWrite is a silent no-op when disabled", () => {
		process.env.PI_SUBAGENTS_JOURNAL = "off";
		journalWrite({ event: "run_start", id: "d", label: "x", kind: "y" });
		const text = readFileSync(path, "utf8");
		assert.ok(!text.includes('"d"'), "disabled journal wrote nothing");
		process.env.PI_SUBAGENTS_JOURNAL = path;
	});

	it("marks a silent running row stale, and a fresh one live (orphan sweep)", () => {
		const now = Date.now();
		// A pi restart kills child sessions before their finally block
		// runs, so this row never gets a run_end. Before the sweep it
		// counted as live work forever (30 live when 5 were real).
		const orphan = JSON.stringify({
			ts: now - STALE_AFTER_MS - 60_000,
			event: "run_start",
			id: "orphan",
			label: "worker",
			kind: "background",
		});
		const fresh = JSON.stringify({
			ts: now - 5_000,
			event: "run_start",
			id: "fresh",
			label: "worker",
			kind: "background",
		});
		const runs = foldJournal([orphan, fresh]);
		const byId = new Map(runs.map((r) => [r.id, r]));
		assert.equal(byId.get("orphan")?.stale, true, "silent row is marked stale");
		assert.equal(byId.get("fresh")?.stale, undefined, "an active row stays live");
		const revived = foldJournal([
			orphan,
			JSON.stringify({ ts: now - 1_000, event: "turn", id: "orphan", turns: 2 }),
		]);
		assert.equal(revived[0]?.stale, undefined, "a fresh event keeps the row live");
	});

	it("keeps the tail of the step log, so a restart still says what it did", () => {
		const now = Date.now();
		const start = JSON.stringify({
			ts: now - 5_000,
			event: "run_start",
			id: "steps",
			label: "worker",
			kind: "background",
		});
		const tool = (detail: string, i: number) =>
			JSON.stringify({
				ts: now - 4_000 + i,
				event: "tool",
				id: "steps",
				tool: "bash",
				turns: 1,
				detail,
			});
		const [run] = foldJournal([
			start,
			tool("go build ./...", 0),
			tool("go test ./...", 1),
			tool("git diff --check", 2),
			tool("sed -n 1,40p x.go", 3),
			tool("rg installTurnBudget", 4),
		]);
		assert.equal(run?.recent?.length, 3);
		assert.deepEqual(
			run?.recent?.map((s) => s.detail),
			["git diff --check", "sed -n 1,40p x.go", "rg installTurnBudget"],
		);
		assert.equal(run?.recent?.[0]?.tool, "bash");
		const [bare] = foldJournal([
			start,
			JSON.stringify({ ts: now - 3_000, event: "tool", id: "steps", tool: "codemode", turns: 1 }),
		]);
		assert.deepEqual(bare?.recent, [{ tool: "codemode" }]);
	});

	it("never marks a finished row stale", () => {
		const now = Date.now();
		const done = JSON.stringify({
			ts: now - STALE_AFTER_MS * 10,
			event: "run_start",
			id: "done-one",
			label: "w",
			kind: "foreground",
		});
		const end = JSON.stringify({
			ts: now - STALE_AFTER_MS * 10 + 5_000,
			event: "run_end",
			id: "done-one",
			status: "done",
			turns: 2,
			elapsedSec: 5,
		});
		const [run] = foldJournal([done, end]);
		assert.equal(run?.status, "done");
		assert.equal(run?.stale, undefined, "stale is a property of running rows only");
	});
});
