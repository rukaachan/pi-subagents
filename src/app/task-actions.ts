/**
 * pi-subagents: the three things you can do to one task.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { liveSession } from "./live-sessions.ts";
import { stopTask } from "./live-runs.ts";
import { launchBackground } from "./background.ts";
import { removedIds, unknownTaskMessage } from "./removed-ids.ts";
import { queueSteer } from "./steer-queue.ts";
import { cut } from "../telemetry/progress.ts";
import { journalWrite } from "../telemetry/journal.ts";
import type { TaskStore } from "../domain/task/index.ts";

export type TaskAction = "steer" | "retry" | "stop";

export interface ActionResult {
	ok: boolean;
	action: TaskAction;
	taskId: string;
	message: string;
	subagent?: string;
	newTaskId?: string;
	queued?: boolean;
}

function fail(action: TaskAction, taskId: string, message: string): ActionResult {
	return { ok: false, action, taskId, message };
}

export async function steerTask(
	store: TaskStore,
	taskId: string,
	text: string | undefined,
): Promise<ActionResult> {
	const rec = store.get(taskId);
	if (!rec) return fail("steer", taskId, unknownTaskMessage(taskId, removedIds));
	if (rec.status !== "running") {
		return fail(
			"steer",
			taskId,
			`Task ${taskId} is not running (${rec.status}); steer only a live leg.`,
		);
	}
	const correction = (text ?? "").trim();
	if (!correction) return fail("steer", taskId, "steer needs text: the correction to send.");
	const view = liveSession(taskId);
	if (!view?.steer) {
		if (!queueSteer(taskId, correction)) {
			return fail("steer", taskId, `Task ${taskId} already holds the most steers it can queue.`);
		}
		journalWrite({ event: "steer", id: taskId, text: cut(correction, 200) });
		return {
			ok: true,
			action: "steer",
			taskId,
			subagent: rec.subagentName,
			queued: true,
			message: `Queued a steer for ${taskId} (${rec.subagentName}); it lands before the child next calls the model.`,
		};
	}
	const ok = await view.steer(correction);
	if (!ok) return fail("steer", taskId, `Task ${taskId} refused the steer; it may be finishing.`);
	journalWrite({ event: "steer", id: taskId, text: cut(correction, 200) });
	return {
		ok: true,
		action: "steer",
		taskId,
		subagent: rec.subagentName,
		message: `Steered ${taskId} (${rec.subagentName}): ${cut(correction, 120)}`,
	};
}

export function stopTaskById(store: TaskStore, taskId: string, why = "TaskControl"): ActionResult {
	const rec = store.get(taskId);
	if (!rec) return fail("stop", taskId, unknownTaskMessage(taskId, removedIds));
	if (rec.status !== "running") {
		return fail("stop", taskId, `Task ${taskId} is not running (${rec.status}); nothing to stop.`);
	}
	if (!stopTask(taskId, why)) {
		return fail("stop", taskId, `Task ${taskId} has no live child to stop; it may be finishing.`);
	}
	journalWrite({ event: "stop", id: taskId, family: "coordination", why });
	return {
		ok: true,
		action: "stop",
		taskId,
		subagent: rec.subagentName,
		message: `Stopped ${taskId} (${rec.subagentName}).`,
	};
}

export function retryTask(store: TaskStore, taskId: string, ctx: ExtensionContext): ActionResult {
	const rec = store.get(taskId);
	if (!rec) return fail("retry", taskId, unknownTaskMessage(taskId, removedIds));
	if (rec.status !== "error") {
		return fail("retry", taskId, `Task ${taskId} is ${rec.status}; retry only a failed leg.`);
	}
	const prompt = rec.prompt?.trim();
	if (!prompt) {
		return fail(
			"retry",
			taskId,
			`Task ${taskId} has no saved prompt (it was restored from disk). Start a new task.`,
		);
	}
	const newTaskId = launchBackground(store, rec.subagent, rec.description, prompt, rec.cwd, ctx, {
		kind: rec.kind === "parallel" ? "parallel" : "background",
		dispatch: rec.dispatch,
		...(rec.runId ? { runId: rec.runId } : {}),
	});
	return {
		ok: true,
		action: "retry",
		taskId,
		newTaskId,
		subagent: rec.subagentName,
		message: `Retrying ${taskId} as ${newTaskId} (${rec.subagentName}). It wakes you when it settles.`,
	};
}
