/**
 * pi-subagents: the read-only detail notice for one board task.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AgentTeamTaskView } from "../../../domain/agent-team/index.ts";
import { getTask } from "../../../app/agent-team/board/index.ts";
import { kvTable } from "../../view/text/index.ts";

export function detailText(view: AgentTeamTaskView): string {
	const task = view.task;
	const rows: [string, string][] = [
		["owner", task.owner ?? "unowned"],
		["scopes", task.writeScopes.join(",") || "none"],
	];
	if (task.round) rows.push(["round", String(task.round)]);
	if (task.crossVerify) {
		const who = task.crossVerifiedBy ? " by " + task.crossVerifiedBy : "";
		rows.push([
			"cross",
			(task.crossVerdict ?? (task.verdict === "pass" ? "pending" : "waiting")) + who,
		]);
	}
	if (view.blockedByOpen.length) rows.push(["blocked", view.blockedByOpen.join(",")]);
	if (task.lastError) rows.push(["last", (task.lastOwner ?? "run") + ": " + task.lastError]);
	for (const attempt of task.attempts?.slice(-2) ?? []) {
		const who = attempt.owner ? " by " + attempt.owner : "";
		const error = attempt.error ? ": " + attempt.error : "";
		rows.push(["attempt", attempt.outcome + who + error]);
	}
	const out = [
		task.id + " · " + task.status.toUpperCase() + " · rev " + task.revision,
		task.subject,
		"",
		kvTable(rows),
	];
	out.push("", task.description || "(no description)");
	return out.join("\n");
}

export async function detailFlow(ctx: ExtensionCommandContext, taskId: string): Promise<void> {
	const view = getTask(taskId);
	if (!view) {
		ctx.ui.notify(`Unknown task "${taskId}".`, "error");
		return;
	}
	ctx.ui.notify(detailText(view));
}
