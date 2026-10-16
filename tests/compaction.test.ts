/**
 * A subagent compacts its own context, and the run must say so.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { compactionNote } from "../src/domain/activity-step.ts";
import { foldJournal } from "../src/telemetry/journal.ts";
import { footerProgress } from "../src/telemetry/progress.ts";
import { trackSession } from "../src/telemetry/track.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-compact-"));
const path = join(dir, "c.ndjson");
process.env.PI_SUBAGENTS_JOURNAL = path;

after(() => {
	delete process.env.PI_SUBAGENTS_JOURNAL;
	rmSync(dir, { recursive: true, force: true });
});

type Listener = (event: {
	type: string;
	reason?: string;
	result?: { tokensBefore?: number; estimatedTokensAfter?: number };
	aborted?: boolean;
}) => void;

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
		emit(event: Parameters<Listener>[0]): void {
			for (const l of listeners) l(event);
		},
	};
}

describe("a compaction inside a subagent", () => {
	it("names what the compaction cost", () => {
		const note = compactionNote(59859, 21000);
		assert.match(note, /context compacted/);
		assert.match(note, /59859 tokens/);
		assert.match(note, /21000 tokens/);
		assert.match(note, /early messages are now a summary/);
	});

	it("reaches the footer as a note", () => {
		const session = fakeSession();
		const stop = trackSession(session, "k1", "worker");
		session.emit({
			type: "compaction_end",
			reason: "threshold",
			result: { tokensBefore: 59859, estimatedTokensAfter: 21000 },
		});
		const snapshot = footerProgress.snapshot("k1");
		assert.ok(snapshot, "the run is live");
		assert.match(snapshot.partial ?? "", /context compacted/);
		stop();
	});

	it("reaches the journal as a compact event", () => {
		const session = fakeSession();
		const stop = trackSession(session, "k2", "worker", { journalId: "c1", kind: "foreground" });
		session.emit({
			type: "compaction_end",
			reason: "threshold",
			result: { tokensBefore: 59859, estimatedTokensAfter: 21000 },
		});
		stop({ status: "done", reportChars: 10 });
		const lines = readFileSync(path, "utf8").trim().split("\n");
		const events = lines.map((l) => JSON.parse(l) as { event: string; tokensBefore?: number });
		const compact = events.find((e) => e.event === "compact");
		assert.ok(compact, "the journal carries the compaction");
		assert.equal(compact?.tokensBefore, 59859);
		const folded = foldJournal(lines);
		const run = folded.find((r) => r.id === "c1");
		assert.equal(run?.compactions, 1, "the folded run counts it");
	});

	it("the watcher marks a compacted run", () => {
		const text = readFileSync(new URL("../tools/watch.mjs", import.meta.url), "utf8");
		assert.match(text, /ev\.event === "compact"/, "the watcher reads the event");
		assert.match(text, /!ctx\$\{run\.compactions\}/, "and marks the row");
	});
});
