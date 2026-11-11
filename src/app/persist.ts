/**
 * pi-subagents: run state on disk, wired to the live store.
 */

import type { InMemoryLedger } from "./ledger.ts";
import type { TaskStore } from "./task-store.ts";
import {
	capRecord,
	defaultStatePath,
	encodeState,
	loadState,
	saveState,
	saveStateAsync,
	STATE_VERSION,
	type PersistedState,
} from "../infra/state-file.ts";

export { defaultStatePath } from "../infra/state-file.ts";
export {
	decodeState,
	encodeState,
	loadState,
	saveState,
	STATE_VERSION,
} from "../infra/state-file.ts";
export type { PersistedState } from "../infra/state-file.ts";

export function serializeState(store: TaskStore, ledger: InMemoryLedger): PersistedState {
	return {
		version: STATE_VERSION,
		savedAt: Date.now(),
		tasks: store.snapshot().map(capRecord),
		ledger: ledger.bySubagent(),
	};
}

export function restoreInto(store: TaskStore, ledger: InMemoryLedger, statePath: string): number {
	const state = loadState(statePath);
	if (!state) return 0;
	// Rows that were live cannot finish: count them as errors so totals add up.
	const interrupted = state.tasks.filter((t) => t.status === "running");
	store.restore(state.tasks);
	ledger.restore(state.ledger);
	ledger.clearRunning();
	for (const rec of interrupted) {
		const row = ledger.bySubagent()[rec.subagentName];
		if (row && row.total > row.done + row.error) ledger.finish(rec.subagentName, "error");
	}
	return state.tasks.length;
}

export const SAVE_DEBOUNCE_MS = 250;

export function attachPersistence(
	store: TaskStore,
	ledger: InMemoryLedger,
	statePath = defaultStatePath(),
): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	// Every save gets a generation. A synchronous flush bumps it, so an async
	// write that started earlier sees `isCurrent() === false` and drops its tmp
	// file instead of renaming over the newer state.
	let generation = 0;
	const flush = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		generation += 1;
		saveState(statePath, encodeState(serializeState(store, ledger)));
	};
	const schedule = () => {
		if (timer) return;
		timer = setTimeout(() => {
			timer = null;
			generation += 1;
			const current = generation;
			const json = encodeState(serializeState(store, ledger));
			// Encoding stays on this thread (it reads live objects); the write
			// and rename, which block on the file system, run off it.
			void saveStateAsync(statePath, json, () => current === generation);
		}, SAVE_DEBOUNCE_MS);
	};
	const onExit = () => flush();
	try {
		process.once("exit", onExit);
	} catch {
		/* no process hooks in some hosts */
	}
	store.onChange = schedule;
	return () => {
		store.onChange = null;
		try {
			process.removeListener("exit", onExit);
		} catch {
			/* no process hooks in some hosts */
		}
		flush();
	};
}
