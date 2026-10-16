/**
 * pi-subagents: what a run is doing, in one line per step.
 */

import type { ActivityStep } from "../domain/activity-step.ts";
import { DETAIL_CHARS, RECENT_LIMIT } from "../domain/activity-step.ts";

/** Collapse whitespace and cut, so a command cannot break the row. */
function oneLine(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function pick(args: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const v = args[key];
		if (typeof v === "string" && v.trim()) return oneLine(v, DETAIL_CHARS);
	}
	return undefined;
}

export function describeToolCall(tool: string, args: unknown): string | undefined {
	const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
	switch (tool) {
		case "bash":
		case "powershell":
			return pick(a, ["command"]);
		case "read":
		case "write":
		case "edit":
			return pick(a, ["path", "file_path", "filePath"]);
		case "grep":
			return pick(a, ["pattern", "query"]);
		case "find":
			return pick(a, ["pattern", "query", "path"]);
		case "ls":
			return pick(a, ["path"]);
		case "codemode":
			return "script";
		case "Task":
		case "subagent": {
			const who = pick(a, ["subagent_type", "agent"]);
			return who ? `→ ${who}` : "delegate";
		}
		case "TaskOutput":
			return pick(a, ["task_id"]);
		default:
			return undefined;
	}
}

export function activityLine(step: ActivityStep): string {
	return step.detail ? `${step.tool} · ${step.detail}` : step.tool;
}

export class ActivityLog {
	private readonly byKey = new Map<string, ActivityStep[]>();

	push(key: string, step: ActivityStep): void {
		const list = this.byKey.get(key);
		if (!list) {
			this.byKey.set(key, [step]);
			return;
		}
		list.push(step);
		if (list.length > RECENT_LIMIT) list.splice(0, list.length - RECENT_LIMIT);
	}

	recent(key: string): ActivityStep[] {
		return [...(this.byKey.get(key) ?? [])];
	}

	drop(key: string): void {
		this.byKey.delete(key);
	}
}

export function activityRows(steps: ActivityStep[]): string[] {
	return steps.slice(-RECENT_LIMIT).map(activityLine);
}
