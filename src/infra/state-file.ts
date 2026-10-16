/**
 * pi-subagents: the state file on disk.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SpawnCounts, TaskRecord } from "../domain/task.ts";

export const STATE_VERSION = 1;
export const STATE_FILE_NAME = "pi-subagents-state.json";
/** Resume reads the tail, so 60 messages bound the row. */
export const MAX_HISTORY_MESSAGES = 60;
export const MAX_RESULT_CHARS = 60_000;
export const MAX_STATE_BYTES = 2_000_000;

export interface PersistedState {
	version: number;
	savedAt: number;
	tasks: TaskRecord[];
	ledger: Record<string, SpawnCounts>;
}

/** Default state path: <agentDir>/pi-subagents-state.json. */
export function defaultStatePath(agentDir?: string): string {
	const dir = agentDir ?? path.join(os.homedir(), ".pi", "agent");
	return path.join(dir, STATE_FILE_NAME);
}

export function capRecord(rec: TaskRecord): TaskRecord {
	const out: TaskRecord = { ...rec };
	if (Array.isArray(out.history) && out.history.length > MAX_HISTORY_MESSAGES) {
		out.history = out.history.slice(-MAX_HISTORY_MESSAGES);
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
		if (json.length <= MAX_STATE_BYTES || tasks.length === 0) return json;
		tasks.shift();
	}
}

export function decodeState(raw: string): PersistedState | null {
	try {
		const parsed = JSON.parse(raw) as Partial<PersistedState>;
		if (!parsed || typeof parsed !== "object") return null;
		if (parsed.version !== STATE_VERSION) return null;
		if (!Array.isArray(parsed.tasks)) return null;
		return {
			version: STATE_VERSION,
			savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
			tasks: parsed.tasks as TaskRecord[],
			ledger: (parsed.ledger ?? {}) as Record<string, SpawnCounts>,
		};
	} catch {
		return null;
	}
}

/** Read + decode. Missing file = null. Never throws. */
export function loadState(statePath: string): PersistedState | null {
	try {
		if (!fs.existsSync(statePath)) return null;
		return decodeState(fs.readFileSync(statePath, "utf-8"));
	} catch {
		return null;
	}
}

/** Write atomically (tmp + rename). Never throws. */
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
