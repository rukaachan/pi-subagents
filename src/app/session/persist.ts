/**
 * pi-subagents: run state on disk, wired to the live store.
 */

import { dirname, resolve } from "node:path";
import type { InMemoryLedger } from "./ledger.ts";
import type { TaskStorePort } from "../../domain/task/index.ts";
import type { TaskRecord } from "../../domain/task/index.ts";
import { freezeRestored } from "../../domain/task/index.ts";
import { restoreAgentTeam, agentTeamSnapshot } from "../agent-team/board/index.ts";
import { coldMailSnapshot, restoreColdMail } from "../agent-team/channel/index.ts";
import { releaseOrphanedTasks } from "../agent-team/board/index.ts";
import { findStateTask } from "../../infra/state/index.ts";
import { journalWrite } from "../../telemetry/journal/index.ts";
import type { StatePort } from "./state-port.ts";
import {
	capRecord,
	defaultStatePath,
	loadState,
	STATE_VERSION,
	type PersistedState,
} from "../../infra/state/index.ts";

export { defaultStatePath, projectStatePath, sessionStatePath } from "../../infra/state/index.ts";
export {
	decodeState,
	encodeState,
	loadState,
	saveState,
	STATE_VERSION,
} from "../../infra/state/index.ts";
export type { PersistedState } from "../../infra/state/index.ts";

/** A row from an older session's file, frozen so it can be resumed. */
export function archivedTask(cwd: string, taskId: string): TaskRecord | undefined {
	const pinned = process.env.PI_SUBAGENTS_STATE?.trim();
	const rec = pinned
		? loadState(resolve(cwd, pinned))?.tasks.find((row) => row.taskId === taskId && row.cwd === cwd)
		: findStateTask(dirname(defaultStatePath()), cwd, taskId);
	if (!rec) return undefined;
	freezeRestored(rec);
	return rec;
}

export function serializeState(store: TaskStorePort, ledger: InMemoryLedger): PersistedState {
	const agentTeam = agentTeamSnapshot();
	const coldMail = coldMailSnapshot();
	return {
		version: STATE_VERSION,
		savedAt: Date.now(),
		tasks: store.snapshot().map(capRecord),
		ledger: ledger.bySubagent(),
		...(agentTeam ? { agentTeam: { ...agentTeam, ...(coldMail ? { coldMail } : {}) } } : {}),
	};
}

export function restoreInto(
	store: TaskStorePort,
	ledger: InMemoryLedger,
	statePath: string,
	port: StatePort,
): number {
	const state = port.load(statePath);
	if (!state) return 0;
	// Rows that were live cannot finish: count them as errors so totals add up.
	const interrupted = state.tasks.filter((t) => t.status === "running");
	if (state.agentTeam) {
		restoreAgentTeam(state.agentTeam);
		restoreColdMail(state.agentTeam.coldMail);
		releaseOrphanedTasks();
	}
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

/** One visible, journaled warning for a failed state write. */
export function reportStateError(message: string, notify?: (message: string) => void): void {
	journalWrite({ event: "state_error", message });
	notify?.(message);
}

export function attachPersistence(
	store: TaskStorePort,
	ledger: InMemoryLedger,
	port: StatePort,
	statePath = defaultStatePath(),
	onError?: (message: string) => void,
): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	// Every save gets a generation. A synchronous flush bumps it, so an async
	// write that started earlier sees `isCurrent() === false` and drops its tmp
	// file instead of renaming over the newer state.
	let generation = 0;
	let lastError: string | undefined;
	const report = (error: string | undefined) => {
		if (!error || error === lastError) return;
		lastError = error;
		onError?.(error);
	};
	const flush = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		generation += 1;
		report(port.save(statePath, port.encode(serializeState(store, ledger))).error);
	};
	const schedule = () => {
		if (timer) return;
		timer = setTimeout(() => {
			timer = null;
			generation += 1;
			const current = generation;
			const json = port.encode(serializeState(store, ledger));
			// Encoding stays on this thread (it reads live objects); the write
			// and rename, which block on the file system, run off it.
			void port
				.saveAsync(statePath, json, () => current === generation)
				.then((result) => report(result.error));
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
