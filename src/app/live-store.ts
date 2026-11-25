/**
 * pi-subagents: the one task store.
 */
import { dirname, resolve } from "node:path";
import { ledger } from "./ledger.ts";
import { TaskStore } from "../domain/task/index.ts";
import { beginTeamSession, setTeamChangeHook } from "./team-store.ts";
import {
	attachPersistence,
	defaultStatePath,
	loadState,
	projectStatePath,
	restoreInto,
	sessionStatePath,
} from "./persist.ts";

export const store = new TaskStore();
let restoredRows = 0;
let statePath = defaultStatePath(undefined, process.cwd());
let detach: (() => void) | null = null;

function agentDir(): string {
	return dirname(defaultStatePath());
}

function sessionFile(cwd: string, sessionId?: string): string {
	const explicit = process.env.PI_SUBAGENTS_STATE?.trim();
	if (explicit) return resolve(cwd, explicit);
	if (sessionId) return sessionStatePath(agentDir(), cwd, sessionId);
	return defaultStatePath(undefined, cwd);
}

function restoreLegacySession(cwd: string, sessionId: string): number {
	const legacy = loadState(projectStatePath(agentDir(), cwd));
	const mine = legacy?.tasks.filter((rec) => rec.sessionId === sessionId) ?? [];
	if (mine.length === 0) return 0;
	store.restore(mine);
	return mine.length;
}

/**
 * Load this session's rows and start saving. Called on every session start;
 * the previous session's writer is flushed and detached first.
 */
export function beginSession(
	cwd = process.cwd(),
	sessionId?: string,
	onError?: (message: string) => void,
): void {
	stopPersistence();
	store.clear();
	ledger.restore({});
	beginTeamSession(sessionId ?? "local");
	statePath = sessionFile(cwd, sessionId);
	restoredRows = restoreIntoCurrent(cwd, sessionId);
	setTeamChangeHook(() => store.touch());
	detach = attachPersistence(store, ledger, statePath, onError);
}

function restoreIntoCurrent(cwd: string, sessionId?: string): number {
	const fromSession = restoreInto(store, ledger, statePath);
	if (fromSession > 0 || !sessionId || process.env.PI_SUBAGENTS_STATE?.trim()) return fromSession;
	return restoreLegacySession(cwd, sessionId);
}

/** Stop the writer and flush once. Safe to call more than once. */
export function stopPersistence(): void {
	detach?.();
	detach = null;
}

/** Where this session reads and writes rows. */
export function currentStatePath(): string {
	return statePath;
}

/** Restored row count from the last Pi session (0 on first run). */
export function restoredCount(): number {
	return restoredRows;
}
