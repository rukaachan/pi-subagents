/**
 * The stall floor must be re-measurable from what the journal keeps.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { after, beforeEach, describe, it, mock } from "node:test";
import { foldJournal } from "../src/telemetry/journal.ts";
import { trackSession } from "../src/telemetry/track.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-gaps-"));
const path = join(dir, "g.ndjson");
process.env.PI_SUBAGENTS_JOURNAL = path;

after(() => {
	delete process.env.PI_SUBAGENTS_JOURNAL;
	rmSync(dir, { recursive: true, force: true });
});

type Listener = (event: { type: string }) => void;

function fakeSession() {
	const listeners: Listener[] = [];
	return {
		subscribe(listener: Listener): () => void {
			listeners.push(listener);
			return () => {
				const i = listeners.indexOf(listener);
				if (i >= 0) listeners.splice(i, 1);
			};
		},
		emit(type = "message_update"): void {
			for (const l of listeners) l({ type });
		},
		listeners: () => listeners.length,
	};
}

function runEndLine(): Record<string, unknown> | undefined {
	const lines = readFileSync(path, "utf8").trim().split("\n");
	const last = lines[lines.length - 1];
	return last ? (JSON.parse(last) as Record<string, unknown>) : undefined;
}

describe("silence metrics reach the journal", () => {
	beforeEach(() => {
		mock.timers.enable({ apis: ["Date"] });
	});

	it("records the longest silence between ANY two events", () => {
		const session = fakeSession();
		const stop = trackSession(session, "k1", "worker", { journalId: "g1", kind: "background" });
		session.emit("message_update");
		mock.timers.tick(10_000);
		session.emit("message_update");
		mock.timers.tick(120_000); // two minutes of silence
		session.emit("tool_execution_start");
		mock.timers.tick(1_000);
		session.emit("turn_end");
		stop({ status: "done" });

		const end = runEndLine();
		assert.equal(end?.gapMaxSec, 120, "the 120s pause is the max, not the sum");
		assert.equal(end?.gapOver60, 1, "one pause reached a minute");

		const folded = foldJournal([
			JSON.stringify({ ts: 0, event: "run_start", id: "g1", label: "worker", kind: "background" }),
			JSON.stringify(end),
		]);
		assert.equal(folded[0]?.gapMaxSec, 120);
		mock.timers.reset();
	});

	it("counts several long pauses and keeps sub-second ones at zero", () => {
		const session = fakeSession();
		const stop = trackSession(session, "k2", "explorer", { journalId: "g2", kind: "parallel" });
		for (let i = 0; i < 3; i += 1) {
			mock.timers.tick(90_000);
			session.emit("message_update");
		}
		mock.timers.tick(400);
		session.emit("message_update");
		stop({ status: "done" });

		const end = runEndLine();
		assert.equal(end?.gapOver60, 3);
		assert.equal(end?.gapMaxSec, 90);
		mock.timers.reset();
	});

	it("drops the session listener when the run ends", () => {
		const session = fakeSession();
		const stop = trackSession(session, "k3", "planner", { journalId: "g3", kind: "foreground" });
		assert.equal(session.listeners(), 1);
		stop({ status: "done" });
		assert.equal(session.listeners(), 0);
		mock.timers.reset();
	});
});
