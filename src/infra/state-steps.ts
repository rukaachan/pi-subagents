/**
 * pi-subagents: validate chain and parallel step lists from disk.
 */

import type { ChainStep, ParallelLeg } from "../domain/task.ts";

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : undefined;
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function state(value: unknown): "pending" | "running" | "done" | "error" {
	return value === "running" || value === "done" || value === "error" ? value : "pending";
}

export function decodeSteps(value: unknown): ChainStep[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: ChainStep[] = [];
	for (const [index, item] of value.entries()) {
		const raw = obj(item);
		const subagentName = raw ? str(raw.subagentName) : "";
		if (!raw || !subagentName) continue;
		const report = typeof raw.report === "string" ? raw.report : undefined;
		const error = typeof raw.error === "string" ? raw.error : undefined;
		out.push({
			idx: num(raw.idx) ?? index,
			subagentName,
			prompt: str(raw.prompt),
			status: state(raw.status),
			...(report ? { report } : {}),
			...(error ? { error } : {}),
			...(num(raw.startedAt) !== undefined ? { startedAt: num(raw.startedAt) } : {}),
			...(num(raw.endedAt) !== undefined ? { endedAt: num(raw.endedAt) } : {}),
		});
	}
	return out.length > 0 ? out : undefined;
}

export function decodeLegs(value: unknown): ParallelLeg[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: ParallelLeg[] = [];
	for (const [index, item] of value.entries()) {
		const raw = obj(item);
		const subagentName = raw ? str(raw.subagentName) : "";
		if (!raw || !subagentName) continue;
		const report = typeof raw.report === "string" ? raw.report : undefined;
		const error = typeof raw.error === "string" ? raw.error : undefined;
		const taskId = typeof raw.taskId === "string" ? raw.taskId : undefined;
		out.push({
			idx: num(raw.idx) ?? index,
			subagentName,
			prompt: str(raw.prompt),
			status: state(raw.status),
			...(report ? { report } : {}),
			...(taskId ? { taskId } : {}),
			...(error ? { error } : {}),
		});
	}
	return out.length > 0 ? out : undefined;
}
