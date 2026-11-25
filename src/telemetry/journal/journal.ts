/**
 * pi-subagents: append-only run journal.
 */
import { fileJournal } from "./file.ts";
import type { JournalEvent } from "./journal-path.ts";
import type { JournalPort } from "./port.ts";

export { JOURNAL_MAX_BYTES, type JournalEvent, defaultJournalPath } from "./journal-path.ts";
export { fileJournal } from "./file.ts";
export type { JournalPort } from "./port.ts";
export { STALE_AFTER_MS, findJournalRun, foldJournal, foldJournalFile } from "./journal-fold.ts";
export type { JournalRun } from "./journal-run.ts";

let sink: JournalPort = fileJournal;

/** Install a sink. The entrypoint installs the file sink; tests can record. */
export function setJournal(port: JournalPort): void {
	sink = port;
}

/** Append one event. Silent no-op when the journal is off; never throws. */
export function journalWrite(ev: JournalEvent): void {
	try {
		sink.write(ev);
	} catch {
		/* the journal is advisory: never break a run */
	}
}
