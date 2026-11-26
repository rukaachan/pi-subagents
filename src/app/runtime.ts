/**
 * pi-subagents: one session runtime and its ports.
 */
import { dirname, resolve } from "node:path";
import { TaskStore } from "../domain/task/index.ts";
import type { TaskStorePort } from "../domain/task/index.ts";
import { beginAgentTeamSession, setAgentTeamChangeHook } from "./agent-team/board/index.ts";
import type { ChildSessionPort } from "./run/index.ts";
import {
	attachPersistence,
	defaultStatePath,
	ledger,
	projectStatePath,
	restoreInto,
	sessionStatePath,
	type StatePort,
} from "./session/index.ts";

export interface RuntimeDeps {
	child: ChildSessionPort;
	state: StatePort;
}

export interface AppDeps extends RuntimeDeps {
	store: TaskStorePort;
}

export interface SessionRuntime {
	deps: AppDeps;
	store: TaskStorePort;
	begin(cwd?: string, sessionId?: string, onError?: (message: string) => void): void;
	stop(): void;
	statePath(): string;
	restored(): number;
}

function agentDir(): string {
	return dirname(defaultStatePath());
}

function sessionFile(cwd: string, sessionId?: string): string {
	const explicit = process.env.PI_SUBAGENTS_STATE?.trim();
	if (explicit) return resolve(cwd, explicit);
	if (sessionId) return sessionStatePath(agentDir(), cwd, sessionId);
	return defaultStatePath(undefined, cwd);
}

export function createSessionRuntime(input: RuntimeDeps): SessionRuntime {
	const store = new TaskStore();
	const deps: AppDeps = { ...input, store };
	let restoredRows = 0;
	let statePath = defaultStatePath(undefined, process.cwd());
	let detach: (() => void) | null = null;

	function restoreLegacySession(cwd: string, sessionId: string): number {
		const legacy = deps.state.load(projectStatePath(agentDir(), cwd));
		const mine = legacy?.tasks.filter((rec) => rec.sessionId === sessionId) ?? [];
		if (mine.length === 0) return 0;
		store.restore(mine);
		return mine.length;
	}

	function restoreIntoCurrent(cwd: string, sessionId?: string): number {
		const fromSession = restoreInto(store, ledger, statePath, deps.state, cwd);
		if (fromSession > 0 || !sessionId || process.env.PI_SUBAGENTS_STATE?.trim()) return fromSession;
		return restoreLegacySession(cwd, sessionId);
	}

	function stop(): void {
		detach?.();
		detach = null;
	}

	/**
	 * Load this session's rows and start saving. Called on every session start;
	 * the previous session's writer is flushed and detached first.
	 */
	function begin(
		cwd = process.cwd(),
		sessionId?: string,
		onError?: (message: string) => void,
	): void {
		stop();
		store.clear();
		ledger.restore({});
		beginAgentTeamSession(sessionId ?? "local");
		statePath = sessionFile(cwd, sessionId);
		restoredRows = restoreIntoCurrent(cwd, sessionId);
		setAgentTeamChangeHook(() => store.touch());
		detach = attachPersistence(store, ledger, deps.state, statePath, onError, cwd);
	}

	return {
		deps,
		store,
		begin,
		stop,
		statePath: () => statePath,
		restored: () => restoredRows,
	};
}
