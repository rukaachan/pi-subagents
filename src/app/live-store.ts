/**
 * pi-subagents: the one task store.
 */
import { ledger } from "./ledger.ts";
import { TaskStore } from "./task-store.ts";
import { attachPersistence, defaultStatePath, restoreInto } from "./persist.ts";

export const store = new TaskStore();
const restoredRows = restoreInto(store, ledger, defaultStatePath());
export const stopPersistence = attachPersistence(store, ledger);

/** Restored row count from the last Pi session (0 on first run). */
export function restoredCount(): number {
	return restoredRows;
}
