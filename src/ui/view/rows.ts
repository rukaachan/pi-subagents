/**
 * pi-subagents: one line per thing in a list.
 */

import type { SubagentConfig } from "../../domain/subagent/config.ts";
import type { TaskRecord } from "../../app/task-record.ts";
import { shortKey } from "./format.ts";
import {
	kindBadge,
	shortText,
	sourceBadge,
	taskStatusIcon,
	toolsBadge,
	usageLine,
} from "./format.ts";

export function subagentRow(sub: SubagentConfig): string {
	const desc = shortText(sub.description || "(no description)", 44);
	return `${sub.name} · ${sourceBadge(sub.source)} — ${desc} (${sub.model}, ${toolsBadge(sub.tools)})`;
}

export function taskRow(rec: TaskRecord): string {
	const icon = taskStatusIcon(rec.status);
	const short = shortKey(rec.taskId);
	const desc = shortText(rec.description, 36);
	const use = rec.result ? ` · ${usageLine(rec.result.usage, rec.result.model)}` : "";
	const who =
		rec.kind === "chain" && rec.steps
			? chainStrip(rec)
			: rec.kind === "parallel" && rec.legs
				? parallelStrip(rec)
				: rec.subagentName;
	const marked = rec.subagent.source === "temp" ? `◌ ${who}` : who;
	return `${icon} ${short} · ${marked} ${kindBadge(rec.kind)} ${rec.status.toUpperCase()} — ${desc}${use}`;
}

export function chainStrip(rec: TaskRecord): string {
	if (!rec.steps || rec.steps.length === 0) return rec.subagentName;
	const icons: Record<string, string> = { done: "✓", error: "✗", running: "…", pending: "·" };
	return rec.steps.map((s) => `${s.subagentName} ${icons[s.status] ?? "·"}`).join(" → ");
}

export function parallelStrip(rec: TaskRecord): string {
	if (!rec.legs || rec.legs.length === 0) return rec.subagentName;
	const icons: Record<string, string> = { done: "✓", error: "✗", running: "…", pending: "·" };
	return rec.legs.map((l) => `${l.subagentName} ${icons[l.status] ?? "·"}`).join(" ⇉ ");
}

export function spawnSummary(
	bySubagent: Record<
		string,
		{
			total: number;
			running: number;
			done: number;
			error: number;
			stopped?: number;
			foreground?: number;
			background?: number;
			alias?: number;
		}
	>,
): string {
	const rows = Object.entries(bySubagent).toSorted(([a], [b]) => a.localeCompare(b));
	if (rows.length === 0) return "Tasks · no runs yet";
	let total = 0;
	let errs = 0;
	let stops = 0;
	const live: string[] = [];
	for (const [name, counts] of rows) {
		total += counts.total;
		errs += counts.error;
		stops += counts.stopped ?? 0;
		if (counts.running > 0) live.push(`${name}×${counts.running}`);
	}
	let title = `Tasks · ${total} run${total === 1 ? "" : "s"}`;
	if (live.length > 0) title += ` · ● ${live.join(", ")}`;
	if (errs > 0) title += ` · ✗ ${errs}`;
	if (stops > 0) title += ` · ⊘ ${stops}`;
	return title;
}
