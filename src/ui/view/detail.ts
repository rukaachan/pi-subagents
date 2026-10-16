/**
 * pi-subagents: the detail panes.
 */

import type { SubagentConfig } from "../../domain/subagent/config.ts";
import type { TaskRecord } from "../../app/task-record.ts";
import { formatElapsed } from "../../telemetry/progress.ts";
import { kvTable, shortPath, sourceBadge, usageLine } from "./format.ts";
import { chainStrip, parallelStrip } from "./rows.ts";

export interface LiveRunInfo {
	status?: string;
	turns?: number;
	tool?: string;
	elapsedSec?: number;
	partial?: string;
	notes?: string[];
}

export function taskDetail(rec: TaskRecord, live?: LiveRunInfo): string {
	const head: [string, string][] = [
		["task", rec.taskId],
		["subagent", rec.subagentName],
		...(rec.subagent.source === "temp"
			? ([["source", "temp (session-scoped)"]] as [string, string][])
			: []),
		["kind", rec.kind ?? "background"],
		["status", rec.status],
		["label", rec.description],
	];
	if (rec.kind === "chain" && rec.steps && rec.steps.length > 0) {
		head.push(["steps", chainStrip(rec)]);
	}
	if (rec.kind === "parallel" && rec.legs && rec.legs.length > 0) {
		head.push(["legs", parallelStrip(rec)]);
	}
	if (rec.result) {
		head.push(["use", usageLine(rec.result.usage, rec.result.model) || "—"]);
		const out = [kvTable(head), "─── output ───"];
		out.push(
			rec.result.text.length > 2000 ? `${rec.result.text.slice(0, 2000)}\n…(cut)` : rec.result.text,
		);
		if (rec.result.notes.length > 0) out.push(`[notes: ${rec.result.notes.join(" ")}]`);
		return out.join("\n");
	}
	if (rec.status === "error") head.push(["error", rec.error ?? "unknown error"]);
	else if (live && (live.turns !== undefined || live.tool)) {
		head.push([
			"live",
			[
				`turns ${live.turns ?? "?"}`,
				live.elapsedSec !== undefined ? `${formatElapsed(live.elapsedSec)}` : "",
				live.tool ? `tool ${live.tool}` : "",
			]
				.filter(Boolean)
				.join(" · "),
		]);
		if (live.partial) head.push(["last", live.partial]);
		head.push([
			"state",
			rec.kind === "parallel" ? "fan-out running — poll again" : "running — poll again",
		]);
	} else {
		head.push(["state", "still running — poll again"]);
	}
	return kvTable(head);
}

function spawnLine(spawns: {
	total: number;
	running: number;
	done: number;
	error: number;
}): string {
	const bits = [`${spawns.total} total`];
	if (spawns.running > 0) bits.push(`${spawns.running} live`);
	if (spawns.done > 0) bits.push(`${spawns.done} done`);
	if (spawns.error > 0) bits.push(`${spawns.error} failed`);
	return bits.join(" · ");
}

export function subagentDetail(
	sub: SubagentConfig,
	spawns?: { total: number; running: number; done: number; error: number },
): string {
	const rows: [string, string][] = [
		["name", sub.name],
		["source", `${sourceBadge(sub.source)} · ${shortPath(sub.filePath)}`],
		["about", sub.description || "(none)"],
		["model", sub.model],
		["thinking", sub.thinkingLevel ?? "(inherit)"],
		["tools", sub.tools ? sub.tools.join(", ") : "(all)"],
		["autonomy", sub.autonomy],
	];
	if (spawns && spawns.total > 0) rows.push(["runs", spawnLine(spawns)]);
	return kvTable(rows);
}
