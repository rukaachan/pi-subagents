/**
 * Watch parity: tools/watch.mjs re-implements the journal fold so it can run on a plain `node` (no type stripping).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldJournal, STALE_AFTER_MS } from "../src/telemetry/journal.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function watch(lines: string[], flag: "--json" | "--once"): string {
	const dir = mkdtempSync(join(tmpdir(), "watch-parity-"));
	try {
		const file = join(dir, "journal.ndjson");
		writeFileSync(file, `${lines.join("\n")}\n`);
		return execFileSync(process.execPath, ["tools/watch.mjs", "--once", flag], {
			cwd: ROOT,
			env: { ...process.env, PI_SUBAGENTS_JOURNAL: file },
			encoding: "utf8",
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const now = Date.now();
const FIXTURE = [
	JSON.stringify({
		ts: now - 9_000,
		event: "run_start",
		id: "task-a",
		label: "worker fix",
		kind: "background",
	}),
	JSON.stringify({ ts: now - 8_000, event: "turn", id: "task-a", turns: 1 }),
	JSON.stringify({
		ts: now - 7_000,
		event: "tool",
		id: "task-a",
		tool: "bash",
		turns: 1,
		detail: "go build ./...",
	}),
	JSON.stringify({
		ts: now - 6_000,
		event: "run_end",
		id: "task-a",
		status: "done",
		turns: 2,
		elapsedSec: 41,
		reportChars: 900,
		model: "m-1",
	}),
];

describe("watch folds the journal the same way as src/journal.ts", () => {
	it("agrees on the fields the table prints", () => {
		const rows = JSON.parse(watch(FIXTURE, "--json")) as Record<string, unknown>[];
		const expected = foldJournal(FIXTURE);
		assert.equal(rows.length, expected.length);
		for (const [i, run] of expected.entries()) {
			const row = rows[i] ?? {};
			// The contract: what the table shows must match the fold.
			assert.equal(row.id, run.id);
			assert.equal(row.status, run.status);
			assert.equal(row.turns, run.turns);
			assert.equal(row.tool, run.tool);
			assert.equal(row.detail, run.recent?.at(-1)?.detail, "latest step detail");
			assert.equal(row.reportChars, run.reportChars);
			assert.equal(row.model, run.model);
			assert.equal(row.elapsedSec, run.elapsedSec);
			assert.equal(row.label, run.label);
			assert.equal(row.kind, run.kind);
		}
	});

	it("prints the current step while a run is live, and the report once it ends", () => {
		// The cell is a live readout: a finished row reports its output
		// size there instead, so the step detail must come from a row
		// that is still running.
		const live = FIXTURE.slice(0, 3);
		const table = watch(live, "--once");
		assert.ok(table.includes("bash · go build ./..."), `missing step detail:\n${table}`);
		assert.ok(table.includes("worker fix"), "label column");
		const done = watch(FIXTURE, "--once");
		assert.ok(done.includes("900ch m-1"), `missing report cell:\n${done}`);
		assert.ok(!done.includes("bash · go build"), "a finished row is not a live readout");
	});

	it("ages an orphan row in both, at the same threshold", () => {
		const aged = [
			JSON.stringify({
				ts: now - STALE_AFTER_MS - 60_000,
				event: "run_start",
				id: "task-orphan",
				label: "worker gone",
				kind: "background",
			}),
			JSON.stringify({
				ts: now - STALE_AFTER_MS - 59_000,
				event: "tool",
				id: "task-orphan",
				tool: "bash",
				turns: 3,
			}),
		];
		const [folded] = foldJournal(aged);
		assert.equal(folded?.stale, true, "fold ages it");
		const rows = JSON.parse(watch(aged, "--json")) as { stale?: boolean }[];
		assert.equal(rows[0]?.stale, true, "watcher ages it too");
		assert.ok(watch(aged, "--once").includes("stale 15m"), "table says so");
		const fresh = [
			JSON.stringify({
				ts: now - 1_000,
				event: "run_start",
				id: "task-live",
				label: "w",
				kind: "background",
			}),
		];
		assert.equal(foldJournal(fresh)[0]?.stale, undefined);
		assert.ok(!watch(fresh, "--once").includes("stale 15m"));
	});

	it("keeps one constant, not two numbers that drift", () => {
		const source = readFileSync(join(ROOT, "tools/watch.mjs"), "utf8");
		const literal = /const STALE_AFTER_MS = ([^;]+);/.exec(source)?.[1];
		assert.ok(literal, "watch declares its own threshold");
		// eslint-disable-next-line no-new-func -- evaluating the file's own literal
		assert.equal(new Function(`return ${literal}`)(), STALE_AFTER_MS);
	});
});
