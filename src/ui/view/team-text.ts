/**
 * pi-subagents: the plain-text team board.
 */

import { taskList, teamMembers, teamSummary } from "../../app/team-store.ts";

export function teamText(): string {
	const summary = teamSummary();
	const members = teamMembers();
	const rows = taskList({ limit: 100 });
	const head = `Team ${summary.teamId} · ${summary.enabled ? "on" : "off"} · ${summary.open} open · ${summary.done} done`;
	const roster = members.length
		? [`Members: ${members.map((member) => member.name).join(", ")}`]
		: [];
	const lines = rows.map((view) => {
		const owner = view.task.owner ?? "unowned";
		const flags = [
			view.ready ? "ready" : "",
			view.blockedByOpen.length ? `blocked by ${view.blockedByOpen.join(",")}` : "",
			view.task.lastError ? `last ${view.task.lastOwner ?? "a run"}: ${view.task.lastError}` : "",
		]
			.filter(Boolean)
			.join(" · ");
		return `${view.task.id} [${view.task.status}] rev ${view.task.revision} · ${view.task.subject} · ${owner}${flags ? ` · ${flags}` : ""}`;
	});
	if (lines.length === 0) lines.push("No tasks yet. Press n in the Team tab or ask the lead.");
	return [head, ...roster, "", ...lines].join("\n");
}
