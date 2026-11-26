/**
 * pi-subagents: wait for one background run to return text.
 */

import type { TaskStorePort } from "../../../domain/task/index.ts";
import { stopTaskById } from "../../run/index.ts";

const POLL_MS = 50;

export type RunText = { ok: true; text: string } | { ok: false; error: string };

function hold(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export async function waitForRunText(
	store: TaskStorePort,
	runId: string,
	timeoutMs: number,
	label: string,
): Promise<RunText> {
	const who = `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const rec = store.get(runId);
		if (!rec) return { ok: false, error: `The ${label} run disappeared before it answered.` };
		if (rec.status === "done") {
			const text = rec.result?.text.trim();
			return text ? { ok: true, text } : { ok: false, error: `The ${label} returned no text.` };
		}
		if (rec.status === "error" || rec.status === "stopped") {
			return { ok: false, error: rec.error ?? `The ${label} run stopped.` };
		}
		if (Date.now() >= deadline) {
			stopTaskById(store, runId, `${label} timeout`);
			return { ok: false, error: `${who} timed out after ${Math.round(timeoutMs / 1000)}s.` };
		}
		await hold(POLL_MS);
	}
}
