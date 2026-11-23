/**
 * pi-subagents: find one task across saved state files.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskRecord } from "../domain/task.ts";
import {
	PROJECT_STATE_DIR,
	STATE_FILE_NAME,
	decodeState,
	projectStatePath,
	readStateFile,
} from "./state-file.ts";

/** Bounds a resume lookup; state files are small and few in practice. */
const MAX_ARCHIVE_FILES = 200;

/**
 * Find one task in any state file for this folder. Resume uses this after a
 * restart, when the row lives in an older session's file.
 */
export function findStateTask(
	agentDir: string,
	cwd: string,
	taskId: string,
): TaskRecord | undefined {
	if (!taskId) return undefined;
	const dir = path.join(agentDir, PROJECT_STATE_DIR);
	const files: { file: string; at: number }[] = [];
	try {
		for (const name of fs.readdirSync(dir)) {
			if (!/^s-[a-f0-9]+\.json$/.test(name)) continue;
			const file = path.join(dir, name);
			try {
				files.push({ file, at: fs.statSync(file).mtimeMs });
			} catch {
				/* raced with a prune */
			}
		}
	} catch {
		/* no state dir yet */
	}
	files.sort((a, b) => b.at - a.at);
	const newest = files.slice(0, MAX_ARCHIVE_FILES).map((entry) => entry.file);
	newest.push(projectStatePath(agentDir, cwd), path.join(agentDir, STATE_FILE_NAME));
	for (const file of newest) {
		const raw = readStateFile(file);
		if (!raw || !raw.includes(taskId)) continue;
		const hit = decodeState(raw)?.tasks.find((rec) => rec.taskId === taskId && rec.cwd === cwd);
		if (hit) return hit;
	}
	return undefined;
}
