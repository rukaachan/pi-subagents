/**
 * pi-subagents: a stopped run keeps its row so it can resume.
 */

import { stoppedRowNote } from "../domain/run-stop.ts";
import type { TaskRecord } from "./task-record.ts";

export function markStopped(rec: TaskRecord | undefined, why: string, now = Date.now()): void {
	if (!rec || rec.status === "stopped") return;
	rec.status = "stopped";
	rec.endedAt = now;
	rec.error = stoppedRowNote(why);
	rec.fullDelivered = false;
	for (const step of rec.steps ?? []) {
		if (step.status === "running") {
			step.status = "error";
			step.error = stoppedRowNote(why);
			step.endedAt = now;
		}
	}
}
