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
	const flush = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		saveState(statePath, encodeState(serializeState(store, ledger)));
	};
	const onExit = () => flush();
	try {
		process.once("exit", onExit);
	} catch {
		/* no process hooks in some hosts */
	}
	store.onChange = () => {
		if (timer) return;
		timer = setTimeout(() => {
			timer = null;
			saveState(statePath, encodeState(serializeState(store, ledger)));
		}, SAVE_DEBOUNCE_MS);
	};
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
