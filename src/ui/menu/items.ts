/**
 * pi-subagents: menu row builders.
 */

import type { SubagentConfig } from "../../domain/subagent/config.ts";
import type { TaskRecord } from "../../app/task-record.ts";
import { kindBadge, shortText, taskStatusIcon, toolsBadge, usageLine } from "../view/format.ts";
import { shortKey } from "../view/format.ts";

function label(name: string): string {
	return name;
}

export function subagentMeta(sub: SubagentConfig): string {
	const src = sub.source === "project" ? "◈" : "◇";
	const model = sub.model === "inherit" ? "" : ` · ${shortModel(sub.model)}`;
	return `${toolsBadge(sub.tools)} ${src}${model}`;
}

export function shortModel(model: string): string {
	const tail = model.slice(model.lastIndexOf("/") + 1);
	return shortText(tail.replace(/-\d{8}$/, ""), 18);
}

export const ROW_DESC_CHARS = 54;

export function subagentRowItems(
	subs: SubagentConfig[],
): { value: string; label: string; description?: string }[] {
	return subs.map((sub) => ({
		value: sub.name,
		label: label(sub.name),
		description: `${subagentMeta(sub)} — ${shortText(sub.description || "(no description)", ROW_DESC_CHARS)}`,
	}));
}

export function taskRowItems(tasks: TaskRecord[]): {
	value: string;
	label: string;
	description?: string;
}[] {
	return tasks.map((rec) => {
		const icon = taskStatusIcon(rec.status);
		const key = shortKey(rec.taskId);
		const who =
			rec.kind === "chain" && rec.steps
				? rec.steps.map((s) => s.subagentName).join("→")
				: rec.kind === "parallel" && rec.legs
					? rec.legs.map((l) => l.subagentName).join("⇉")
					: rec.subagentName;
		const use = rec.result ? usageLine(rec.result.usage, rec.result.model) : "";
		const bits = [
			`${kindBadge(rec.kind)} ${rec.status}`,
			shortText(rec.description, 40),
			use,
		].filter(Boolean);
		return {
			value: rec.taskId,
			label: `${icon} ${key} ${who}`,
			description: bits.join(" — "),
		};
	});
}

export function trashRowItems(items: { base: string; stamp: string; fileName: string }[]): {
	value: string;
	label: string;
	description?: string;
}[] {
	return items.map((i) => ({
		value: i.base,
		label: i.base,
		description: `${i.stamp} · ${i.fileName}`,
	}));
}
