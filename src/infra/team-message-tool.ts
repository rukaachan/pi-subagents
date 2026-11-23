/**
 * pi-subagents: the live teammate message tool.
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import type { TeamMessageApi } from "../domain/team-mail.ts";
import { PARAMETERS, type Params } from "./team-message-schema.ts";
import { renderTeamMessageCall, renderTeamMessageResult } from "./team-render.ts";

function fail(message: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: { error: message },
		isError: true,
	};
}

function ok(text: string, details: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

/** Build TeamMessage for the lead (no member) or one teammate. */
export function createTeamMessageTool(api: TeamMessageApi, member?: string) {
	return defineTool({
		name: "TeamMessage",
		label: "TeamMessage",
		description:
			"Talk to a teammate, or wait for its run to settle. send delivers text on a live target's next turn; a known finished member gets a bounded session queue, delivered on its next run. wait returns the report when the named run finishes (120s cap), including a finished member's last run. Queued mail is not saved to disk.",
		parameters: PARAMETERS,
		async execute(_toolCallId, params) {
			const input = params as Params;
			if (!input.to) return fail(`${input.action} needs to.`);
			if (input.action === "send") {
				if (!input.text) return fail("send needs text.");
				const sent = api.send(member, input.to, input.text);
				if (!sent.ok) return fail(sent.error ?? "The message was not sent.");
				const cut = sent.truncated ? ` (truncated to ${sent.chars})` : "";
				if (sent.queued) {
					return ok(`Queued for ${input.to} (not running); it will get it on its next run${cut}.`, {
						to: input.to,
						chars: sent.chars,
						truncated: sent.truncated ?? false,
						queued: true,
					});
				}
				return ok(`Sent to ${input.to}${cut}.`, {
					to: input.to,
					chars: sent.chars,
					truncated: sent.truncated ?? false,
				});
			}
			const out = await api.wait(member, input.to, input.timeout_ms);
			if (out.kind === "failed") return fail(out.error);
			if (out.kind === "running") {
				const secs = Math.max(1, Math.round(out.waitedMs / 1_000));
				return ok(`${input.to} is still running after ${secs}s. Its settle card will wake you.`, {
					to: input.to,
					task_id: out.taskId,
					status: "running",
					waited_ms: out.waitedMs,
				});
			}
			const body = [
				`${input.to} ${out.status} · ${out.taskId}`,
				out.error ? `error: ${out.error}` : "",
				out.report,
			]
				.filter(Boolean)
				.join("\n\n");
			return ok(body, {
				to: input.to,
				task_id: out.taskId,
				status: out.status,
				report: out.report,
				...(out.error ? { error: out.error } : {}),
			});
		},
		renderCall(args, theme) {
			return renderTeamMessageCall(args.action, args.to, theme);
		},
		renderResult(result, { expanded }, theme) {
			return renderTeamMessageResult(result, expanded, theme);
		},
	});
}
