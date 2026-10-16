/**
 * pi-subagents: the Task tool.
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { usageFooter, resultShell } from "../../ui/tool-results.ts";
import { shortText } from "../../ui/view/format.ts";
import { executeTask } from "./execute.ts";
import { taskMeta } from "./meta.ts";
import { taskSchema } from "./schema.ts";

export const taskTool = defineTool({
	...taskMeta,
	...taskSchema,
	execute: executeTask,

	renderCall(args, theme, _context) {
		const label =
			typeof args.description === "string" && args.description ? args.description : "task";
		const name = typeof args.subagent_type === "string" ? args.subagent_type : "...";
		const bg = args.run_in_background === true ? " (bg)" : "";
		const re = typeof args.resume === "string" && args.resume ? ` (resume ${args.resume})` : "";
		const text =
			theme.fg("toolTitle", theme.bold("Task ")) +
			theme.fg("accent", name) +
			theme.fg("dim", ` ${label}${bg}${re}`);
		return new Text(text, 0, 0);
	},

	renderResult(result, { expanded }, theme, _context) {
		const details = result.details as
			| {
					subagent_type?: string;
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
		if (
			details?.error ||
			body.startsWith("Unknown subagent") ||
			body.startsWith('Subagent "') ||
			body.startsWith("Too many") ||
			body.startsWith('"complexity"')
		) {
			return new Text(
				`${theme.fg("error", "✗ Task")} ${theme.fg("dim", shortText(body, 200))}`,
				0,
				0,
			);
		}
		if (details?.task_id) {
			const line = `${theme.fg("success", "✓ Task")} ${theme.fg("accent", details.task_id)}${theme.fg("dim", ` (${details.subagent_type ?? "?"})`)}`;
			return new Text(expanded ? `${line}\n${theme.fg("dim", shortText(body, 300))}` : line, 0, 0);
		}
		const head = `${theme.fg("success", "✓ Task")}${usageFooter(theme, details?.usage, details?.model)}`;
		return resultShell(theme, head, body, 2000, 160, expanded);
	},
});
