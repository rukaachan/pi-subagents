/**
 * pi-subagents: the state file on disk.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SpawnCounts, TaskRecord } from "../../domain/task/index.ts";
import { decodeTasks } from "./state-validate.ts";
import { decodeTeam, type PersistedTeam } from "./state-team.ts";

export const STATE_VERSION = 1;
export const STATE_FILE_NAME = "pi-subagents-state.json";
export const PROJECT_STATE_DIR = "pi-subagents-state";
/** Resume reads the tail, so 60 messages bound the row. */
export const MAX_HISTORY_MESSAGES = 60;
/**
 * A character budget for those messages.
 *
 * Message count alone is not a size bound: 60 tool results can be megabytes,
 * and every save rewrites the whole state file. Oldest messages are dropped
 * first, and the newest message always survives so a resume still has the
 * last turn.
 */
export const MAX_HISTORY_CHARS = 24_000;
export const MAX_RESULT_CHARS = 60_000;
export const MAX_STATE_BYTES = 2_000_000;

export interface PersistedState {
	version: number;
	savedAt: number;
	tasks: TaskRecord[];
	ledger: Record<string, SpawnCounts>;
	team?: PersistedTeam;
}

/** One state file per project, so two repos never share a board. */
export function projectStatePath(agentDir: string, cwd: string): string {
	const key = createHash("sha1").update(cwd).digest("hex").slice(0, 12);
	return path.join(agentDir, PROJECT_STATE_DIR, `${key}.json`);
}

/** One state file per Pi session, so two sessions never overwrite each other. */
export function sessionStatePath(agentDir: string, cwd: string, sessionId: string): string {
	const key = createHash("sha1").update(`${cwd}\0${sessionId}`).digest("hex").slice(0, 16);
	return path.join(agentDir, PROJECT_STATE_DIR, `s-${key}.json`);
}

/** The legacy global path when `cwd` is omitted; otherwise the project path. */
export function defaultStatePath(agentDir?: string, cwd?: string): string {
	const dir = agentDir ?? path.join(os.homedir(), ".pi", "agent");
	return cwd === undefined ? path.join(dir, STATE_FILE_NAME) : projectStatePath(dir, cwd);
}

/** Messages are snapshots: one size measurement is enough for every save. */
const messageBytes = new WeakMap<object, number>();

function bytesOf(message: unknown): number {
	if (message && typeof message === "object") {
		const hit = messageBytes.get(message);
		if (hit !== undefined) return hit;
		let size = 0;
		try {
			size = JSON.stringify(message)?.length ?? 0;
		} catch {
			size = 0;
		}
		messageBytes.set(message, size);
		return size;
	}
	try {
		return JSON.stringify(message)?.length ?? 0;
	} catch {
		return 0;
	}
}

export function capRecord(rec: TaskRecord): TaskRecord {
	const out: TaskRecord = { ...rec };
	if (Array.isArray(out.history)) {
		let history = out.history;
		if (history.length > MAX_HISTORY_MESSAGES) history = history.slice(-MAX_HISTORY_MESSAGES);
		const sizes = history.map(bytesOf);
		let total = sizes.reduce((sum, size) => sum + size, 0);
		let start = 0;
		while (start < history.length - 1 && total > MAX_HISTORY_CHARS) {
			total -= sizes[start] ?? 0;
			start += 1;
		}
		out.history = history.slice(start);
	}
	if (out.result && out.result.text.length > MAX_RESULT_CHARS) {
		out.result = {
			...out.result,
			text: `${out.result.text.slice(0, MAX_RESULT_CHARS)}\n…(cut on save)`,
		};
	}
	if (out.steps) {
		out.steps = out.steps.map((step) =>
			step.report && step.report.length > MAX_RESULT_CHARS
				? { ...step, report: `${step.report.slice(0, MAX_RESULT_CHARS)}\n…(cut on save)` }
				: step,
		);
	}
	return out;
}

export function encodeState(state: PersistedState): string {
	const tasks = state.tasks.slice();
	for (;;) {
		const json = JSON.stringify({ ...state, tasks });
		if (Buffer.byteLength(json, "utf8") <= MAX_STATE_BYTES || tasks.length === 0) return json;
		tasks.shift();
	}
}

export function decodeState(raw: string): PersistedState | null {
	try {
		const parsed = JSON.parse(raw) as Partial<PersistedState>;
		if (!parsed || typeof parsed !== "object") return null;
		if (parsed.version !== STATE_VERSION) return null;
		if (!Array.isArray(parsed.tasks)) return null;
		const team = decodeTeam(parsed.team);
		return {
			version: STATE_VERSION,
			savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
			tasks: decodeTasks(parsed.tasks),
			ledger: decodeLedger(parsed.ledger),
			...(team ? { team } : {}),
		};
	} catch {
		return null;
	}
}

function decodeLedger(value: unknown): Record<string, SpawnCounts> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const raw = value as Record<string, unknown>;
	const out: Record<string, SpawnCounts> = {};
	for (const [name, item] of Object.entries(raw)) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const row = item as Record<string, unknown>;
		const total = numberOrUndefined(row.total);
		const running = numberOrUndefined(row.running);
		const done = numberOrUndefined(row.done);
		const error = numberOrUndefined(row.error);
		if (total === undefined || running === undefined || done === undefined || error === undefined)
			continue;
		out[name] = {
			total,
			running,
			done,
			error,
			stopped: numberOrUndefined(row.stopped) ?? 0,
			foreground: numberOrUndefined(row.foreground) ?? 0,
			background: numberOrUndefined(row.background) ?? 0,
			alias: numberOrUndefined(row.alias) ?? 0,
		};
	}
	return out;
}

function numberOrUndefined(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Read one state file under the byte budget. Missing, oversized, or unreadable = null. */
export function readStateFile(file: string): string | null {
	try {
		const stat = fs.statSync(file);
		if (!stat.isFile() || stat.size > MAX_STATE_BYTES) return null;
		return fs.readFileSync(file, "utf-8");
	} catch {
		return null;
	}
}

/** Read + decode. Missing file = null. Never throws. */
export function loadState(statePath: string): PersistedState | null {
	const raw = readStateFile(statePath);
	return raw === null ? null : decodeState(raw);
}

let asyncSeq = 0;

/**
 * Write atomically (tmp + rename) without blocking the event loop.
 *
 * `isCurrent` lets the caller cancel a stale snapshot before the rename, so a
 * newer synchronous flush can never be overwritten by an older async write.
 * Never throws.
 */
export async function saveStateAsync(
	statePath: string,
	json: string,
	isCurrent: () => boolean = () => true,
): Promise<{ error?: string }> {
	try {
		await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
		asyncSeq += 1;
		const tmp = `${statePath}.${process.pid}.${asyncSeq}.tmp`;
		await fs.promises.writeFile(tmp, json, "utf-8");
		if (!isCurrent()) {
			await fs.promises.rm(tmp, { force: true });
			return {};
		}
		await fs.promises.rename(tmp, statePath);
		return {};
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}

/** Write atomically (tmp + rename). Never throws. */
export const fileState = {
	load: loadState,
	encode: encodeState,
	save: saveState,
	saveAsync: saveStateAsync,
};

export function saveState(statePath: string, json: string): { error?: string } {
	try {
		fs.mkdirSync(path.dirname(statePath), { recursive: true });
		const tmp = `${statePath}.tmp`;
		fs.writeFileSync(tmp, json, "utf-8");
		fs.renameSync(tmp, statePath);
		return {};
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}
