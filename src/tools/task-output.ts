/**
 * pi-subagents: polling a background task.
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { footerProgress } from "../telemetry/progress.ts";
import { shortText } from "../ui/view/format.ts";
import { resultShell, toUsage, usageFooter } from "../ui/tool-results.ts";
import { store } from "../app/live-store.ts";
import { unknownTaskMessage } from "../app/removed-ids.ts";

export const taskOutputTool = defineTool({
	name: "TaskOutput",
	label: "TaskOutput",
	description:
		"Poll one background task by task_id. Returns status plus result. Full text comes once on first done poll.",
	parameters: Type.Object({
		task_id: Type.String({ description: "task_id from a background Task call" }),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		const rec = store.get(params.task_id);
		if (!rec) {
			return {
				content: [{ type: "text", text: unknownTaskMessage(params.task_id) }],
				details: { task_id: params.task_id },
				isError: true,
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
					...snap,
				},
			};
		}
		if (rec.status === "error") {
			return {
				content: [
					{
						type: "text",
						text: `Task ${rec.taskId} (${rec.subagentName}) failed: ${rec.error ?? "unknown error"}`,
					},
				],
				details: { task_id: rec.taskId, status: "error", error: rec.error },
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
			return {
				content: [{ type: "text", text: `${result.text}${noteText}` }],
				details: {
					task_id: rec.taskId,
					status: "done",
					subagent_type: rec.subagentName,
					usage: result.usage,
					model: result.model,
					dispatch: rec.dispatch,
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
		const details = result.details as
			| {
					task_id?: string;
					status?: string;
					error?: string;
					usage?: {
						input: number;
						output: number;
						cacheRead: number;
						cacheWrite: number;
						cost: number;
						turns: number;
					};
					model?: string;
			  }
			| undefined;
		const text = result.content[0];
		const body = text?.type === "text" ? text.text : "(no output)";
		const id = details?.task_id ?? "";
		if (
			details?.status === "error" ||
			details?.error ||
			body.startsWith("Unknown task_id") ||
			body.includes("was stopped") ||
			body.includes("has no result")
		) {
			return new Text(
				`${theme.fg("error", "✗ TaskOutput")} ${theme.fg("accent", id)} ${theme.fg("dim", shortText(body, 200))}`,
				0,
				0,
			);
		}
		if (details?.status === "running") {
			const d = details as { turns?: number; elapsedSec?: number; tool?: string };
			const parts: string[] = ["running"];
			if (typeof d.turns === "number") parts.push(`t${d.turns}`);
			if (typeof d.elapsedSec === "number") parts.push(`${d.elapsedSec}s`);
			if (typeof d.tool === "string") parts.push(d.tool);
			return new Text(
				`${theme.fg("warning", "… TaskOutput")} ${theme.fg("accent", id)} ${theme.fg("dim", parts.join(" · "))}`,
				0,
				0,
			);
		}
		const head = `${theme.fg("success", "✓ TaskOutput")} ${theme.fg("accent", id)}${usageFooter(theme, details?.usage, (details as { model?: string })?.model)}`;
		return resultShell(theme, head, body, 2000, 160, expanded);
	},
});
