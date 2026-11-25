/**
 * pi-subagents: append-only run journal.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { JOURNAL_MAX_BYTES, type JournalEvent, defaultJournalPath } from "./journal-path.ts";

export { JOURNAL_MAX_BYTES, type JournalEvent, defaultJournalPath } from "./journal-path.ts";
export {
	STALE_AFTER_MS,
	findJournalRun,
	foldJournal,
	foldJournalFile,
	type JournalRun,
} from "./journal-fold.ts";

function enabled(): boolean {
	return process.env.PI_SUBAGENTS_JOURNAL !== "off";
}

/** Append one event. Silent no-op when the journal is off; never throws. */
export function journalWrite(ev: JournalEvent): void {
	if (!enabled()) return;
	try {
		const path = defaultJournalPath();
		mkdirSync(dirname(path), { recursive: true });
		rotateIfNeeded(path);
		appendFileSync(path, `${JSON.stringify(ev)}\n`, "utf8");
	} catch {
		/* the journal is advisory: never break a run */
	}
}

function rotateIfNeeded(path: string): void {
	try {
		const stat = statSync(path);
		if (stat.size <= JOURNAL_MAX_BYTES) return;
		renameSync(path, `${path}.1`);
	} catch {
		/* the journal is advisory */
	}
}
