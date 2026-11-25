/**
 * pi-subagents: the journal port.
 */
import type { JournalEvent } from "./journal-path.ts";

export interface JournalPort {
	write(event: JournalEvent): void;
}
