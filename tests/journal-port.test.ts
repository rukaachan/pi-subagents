/**
 * The journal sink is a port: a test can record it without a file.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	fileJournal,
	journalWrite,
	setJournal,
	type JournalEvent,
} from "../src/telemetry/journal/index.ts";
import { trackSession } from "../src/telemetry/live/index.ts";

describe("the journal port", () => {
	const seen: JournalEvent[] = [];
	after(() => setJournal(fileJournal));

	it("records exactly the events the caller writes", () => {
		seen.length = 0;
		setJournal({ write: (event) => seen.push(event) });
		journalWrite({ event: "state_error", message: "disk full" });
		journalWrite({ event: "gate", tool: "bash", reason: "rm -rf" });
		assert.deepEqual(seen, [
			{ event: "state_error", message: "disk full" },
			{ event: "gate", tool: "bash", reason: "rm -rf" },
		]);
	});

	it("carries usage fields into run_end", () => {
		seen.length = 0;
		setJournal({ write: (event) => seen.push(event) });
		const stop = trackSession({ subscribe: () => () => {} }, "probe", "worker ab12", {
			journalId: "run-1",
		});
		stop({
			status: "done",
			promptChars: 100,
			inputTokens: 1000,
			outputTokens: 50,
			cost: 0.25,
		});
		const end = seen.find((event) => event.event === "run_end");
		assert.ok(end && end.event === "run_end");
		assert.equal(end.promptChars, 100);
		assert.equal(end.inputTokens, 1000);
		assert.equal(end.outputTokens, 50);
		assert.equal(end.cost, 0.25);
	});
});
