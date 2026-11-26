/**
 * pi-subagents: the read-only detail notice for one board task.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AgentTeamTaskView } from "../../../domain/agent-team/index.ts";
import { getTask } from "../../../app/agent-team/board/index.ts";

export function detailText(view: AgentTeamTaskView): string {
	const task = view.task;
	return [
		`${task.id} [${task.status}] rev ${task.revision} · ${task.subject}`,
		`owner: ${task.owner ?? "unowned"} · scopes: ${task.writeScopes.join(",") || "none"}`,
		view.blockedByOpen.length ? `blocked by: ${view.blockedByOpen.join(",")}` : "",
		task.lastError ? `last ${task.lastOwner ?? "run"}: ${task.lastError}` : "",
		...(task.attempts
			?.slice(-2)
			.map((attempt) =>
				attempt.outcome === "passed"
					? `passed by ${attempt.owner ?? "run"}`
					: `${attempt.outcome}${attempt.owner ? ` by ${attempt.owner}` : ""}${attempt.error ? `: ${attempt.error}` : ""}`,
			) ?? []),
		task.description || "(no description)",
	]
		.filter(Boolean)
		.join("\n");
}

export async function detailFlow(ctx: ExtensionCommandContext, taskId: string): Promise<void> {
	const view = getTask(taskId);
	if (!view) {
		ctx.ui.notify(`Unknown task "${taskId}".`, "error");
		return;
	}
	ctx.ui.notify(detailText(view));
}
