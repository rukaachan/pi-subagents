/**
 * pi-subagents: polling a background task.
 */

import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { footerProgress } from "../telemetry/progress.ts";
import { renderTaskOutputResult } from "../ui/view/task-output-result.ts";
import { toUsage } from "../ui/tool-results.ts";
import { store } from "../app/live-store.ts";
import { inTaskScope } from "../app/task-scope.ts";
import { unknownTaskMessage } from "../app/removed-ids.ts";
import { failureHint, labelFailure } from "../domain/policy/index.ts";
import { capDelivery, MAX_DELIVERY_CHARS } from "../domain/run/index.ts";
import { journalWrite } from "../telemetry/journal.ts";

export const taskOutputTool = defineTool({
	name: "TaskOutput",
	label: "TaskOutput",
	description:
		"Poll one background task by task_id. Returns status plus result. Full text comes once on first done poll. Optional failure labels a finished task once: spec, coordination, or verification.",
	parameters: Type.Object({
		task_id: Type.String({ description: "task_id from a background Task call" }),
		failure: Type.Optional(
			Type.Union(
				[Type.Literal("spec"), Type.Literal("coordination"), Type.Literal("verification")],
				{
					description: "Label a finished task's failure once; never inferred by the pack.",
				},
			),
		),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const rec = store.get(params.task_id);
		const scope = { cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId() };
		if (!rec || !inTaskScope(rec, scope)) {
			return {
				content: [{ type: "text", text: unknownTaskMessage(params.task_id) }],
				details: { task_id: params.task_id },
				isError: true,
			};
		}
		const label = labelFailure(rec.status, rec.failure, params.failure);
		if (label?.kind === "bad") {
			return {
				content: [
					{
						type: "text",
						text: `Unknown failure "${String(params.failure)}". Use spec, coordination, or verification.`,
					},
				],
				details: { task_id: rec.taskId, bad_failure: params.failure },
				isError: true,
			};
		}
		if (label?.kind === "running") {
			return {
				content: [
					{
						type: "text",
						text: `Task ${rec.taskId} is still running; label it after it fails.`,
					},
				],
				details: { task_id: rec.taskId, status: "running" },
				isError: true,
			};
		}
		if (label?.kind === "kept") {
			return {
				content: [
					{
						type: "text",
						text: `Task ${rec.taskId} is already labeled ${label.family}; kept it.`,
					},
				],
				details: { task_id: rec.taskId, failure: label.family, status: rec.status },
			};
		}
		if (label?.kind === "set") {
			rec.failure = label.family;
			store.touch();
			journalWrite({ event: "failure", id: rec.taskId, family: label.family });
			return {
				content: [
					{
						type: "text",
						text: `Labeled ${label.family} on ${rec.taskId} (${rec.subagentName}).`,
					},
				],
				details: { task_id: rec.taskId, failure: label.family, status: rec.status },
			};
		}
		if (rec.status === "running") {
			const snap = footerProgress.snapshot(params.task_id);
			const where = snap
				? ` (turns ${snap.turns}, ${snap.elapsedSec}s${snap.tool ? `, tool ${snap.tool}` : ""})`
				: "";
			return {
				content: [
					{
						type: "text",
						text: `Task ${rec.taskId} (${rec.subagentName}) is still running${where}. Poll again later.`,
					},
				],
				details: {
					task_id: rec.taskId,
					status: "running",
					subagent_type: rec.subagentName,
					dispatch: rec.dispatch,
					...(rec.runId ? { run_id: rec.runId } : {}),
					...snap,
				},
			};
		}
		if (rec.status === "stopped") {
			return {
				content: [
					{
						type: "text",
						text: `Task ${rec.taskId} (${rec.subagentName}) was stopped: ${rec.error ?? "interrupted"}. Resume it by id, or start a new task.`,
					},
				],
				details: {
					task_id: rec.taskId,
					status: "stopped",
					subagent_type: rec.subagentName,
					...(rec.runId ? { run_id: rec.runId } : {}),
				},
			};
		}
		if (rec.status === "error") {
			return {
				content: [
					{
						type: "text",
						text: `Task ${rec.taskId} (${rec.subagentName}) failed: ${rec.error ?? "unknown error"}${rec.failure ? "" : `\n${failureHint()}`}`,
					},
				],
				details: {
					task_id: rec.taskId,
					status: "error",
					error: rec.error,
					...(rec.failure ? { failure: rec.failure } : {}),
				},
				isError: true,
			};
		}
		const result = rec.result;
		if (!result) {
			return {
				content: [{ type: "text", text: `Task ${rec.taskId} done but has no result.` }],
				details: { task_id: rec.taskId, status: "done" },
				isError: true,
			};
		}
		if (!rec.fullDelivered) {
			rec.fullDelivered = true;
			const noteText = result.notes.length > 0 ? `\n\n[notes: ${result.notes.join(" ")}]` : "";
			const full = `${result.text}${noteText}`;
			return {
				content: [{ type: "text", text: capDelivery(full) }],
				details: {
					task_id: rec.taskId,
					status: "done",
					subagent_type: rec.subagentName,
					usage: result.usage,
					model: result.model,
					dispatch: rec.dispatch,
					...(rec.failure ? { failure: rec.failure } : {}),
					...(result.missing ? { missing: result.missing } : {}),
					...(full.length > MAX_DELIVERY_CHARS ? { truncated: true, full_chars: full.length } : {}),
				},
				usage: toUsage(result.usage),
			};
		}
		return {
			content: [
				{
					type: "text",
					text: `Task ${rec.taskId} (${rec.subagentName}) done. Full text was already delivered.`,
				},
			],
			details: {
				task_id: rec.taskId,
				status: "done",
				subagent_type: rec.subagentName,
				usage: result.usage,
				dispatch: rec.dispatch,
				...(rec.failure ? { failure: rec.failure } : {}),
				...(result.missing ? { missing: result.missing } : {}),
			},
		};
	},

	renderCall(args, theme, _context) {
		const id = typeof args.task_id === "string" ? args.task_id : "...";
		return new Text(
			theme.fg("toolTitle", theme.bold("TaskOutput ")) + theme.fg("accent", id),
			0,
			0,
		);
	},

	renderResult(result, { expanded }, theme, _context) {
		return renderTaskOutputResult(result, expanded, theme);
	},
});
