/**
 * pi-subagents: steer, retry, or stop one task.
 */

import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { SessionRuntime } from "../app/index.ts";
import { inTaskScope } from "../app/session/index.ts";
import { retryTask, steerTask, stopTaskById, type ActionResult } from "../app/run/index.ts";
import { unknownTaskMessage } from "../app/stop/index.ts";
import { shortText } from "../ui/view/text/index.ts";

export function createTaskControlTool(runtime: SessionRuntime) {
	return defineTool({
		name: "TaskControl",
		label: "TaskControl",
		description:
			"Control one task. steer: queue a correction into a running leg (text required). retry: start a failed leg again from its original prompt; returns a new task_id. stop: end a running leg now and remove its row.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("steer"), Type.Literal("retry"), Type.Literal("stop")], {
				description: "steer, retry, or stop",
			}),
			task_id: Type.String({ description: "task_id of the task to control" }),
			text: Type.Optional(Type.String({ description: "the correction to send (steer only)" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const rec = runtime.store.get(params.task_id);
			const scope = { cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId() };
			if (!rec || !inTaskScope(rec, scope)) {
				return toToolResult({
					ok: false,
					action: params.action,
					taskId: params.task_id,
					message: unknownTaskMessage(params.task_id),
				});
			}
			const result =
				params.action === "steer"
					? await steerTask(runtime.store, params.task_id, params.text)
					: params.action === "stop"
						? stopTaskById(runtime.store, params.task_id)
						: retryTask(runtime.store, params.task_id, ctx, runtime.deps);
			return toToolResult(result);
		},

		renderCall(args, theme, _context) {
			const action = typeof args.action === "string" ? args.action : "...";
			const id = typeof args.task_id === "string" ? args.task_id : "...";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("TaskControl "))}${theme.fg("accent", action)} ${theme.fg("dim", id)}`,
				0,
				0,
			);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as
				| { action?: string; task_id?: string; new_task_id?: string; error?: string }
				| undefined;
			const body = result.content[0];
			const text = body?.type === "text" ? body.text : "(no output)";
			if (result.isError || details?.error) {
				return new Text(
					`${theme.fg("error", "✗ TaskControl")} ${theme.fg("dim", shortText(text, 200))}`,
					0,
					0,
				);
			}
			const head = `${theme.fg("success", "✓ TaskControl")} ${theme.fg("accent", details?.action ?? "?")} ${theme.fg("dim", details?.new_task_id ?? details?.task_id ?? "")}`;
			return new Text(expanded ? `${head}\n${theme.fg("dim", shortText(text, 300))}` : head, 0, 0);
		},
	});
}

function toToolResult(result: ActionResult) {
	const details: Record<string, unknown> = {
		action: result.action,
		task_id: result.taskId,
		...(result.subagent ? { subagent_type: result.subagent } : {}),
		...(result.newTaskId ? { new_task_id: result.newTaskId } : {}),
		...(result.queued ? { queued: true } : {}),
	};
	if (!result.ok) {
		return {
			content: [{ type: "text" as const, text: result.message }],
			details: { ...details, error: result.message },
			isError: true,
		};
	}
	return { content: [{ type: "text" as const, text: result.message }], details };
}
