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

describe("the journal port", () => {
	const seen: JournalEvent[] = [];
	after(() => setJournal(fileJournal));

	it("records exactly the events the caller writes", () => {
		setJournal({ write: (event) => seen.push(event) });
		journalWrite({ event: "state_error", message: "disk full" });
		journalWrite({ event: "gate", tool: "bash", reason: "rm -rf" });
		assert.deepEqual(seen, [
			{ event: "state_error", message: "disk full" },
			{ event: "gate", tool: "bash", reason: "rm -rf" },
		]);
	});
});
