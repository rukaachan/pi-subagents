/**
 * pi-subagents: validate records read from disk.
 */

import type { RunKind, TaskRecord, TaskStatus } from "../domain/task.ts";
import { decodeLegs, decodeSteps } from "./state-steps.ts";
import type { FailureFamily } from "../domain/failure.ts";
import type {
	SubagentAutonomy,
	SubagentConfig,
	SubagentSource,
} from "../domain/subagent/config.ts";
import type { SubagentRunResult, SubagentUsage } from "../domain/run-result.ts";

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : undefined;
}

function str(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function status(value: unknown): TaskStatus | undefined {
	return value === "running" || value === "done" || value === "error" ? value : undefined;
}

function source(value: unknown): SubagentSource {
	return value === "project" || value === "temp" ? value : "user";
}

function autonomy(value: unknown): SubagentAutonomy {
	return value === "inherit" ||
		value === "off" ||
		value === "low" ||
		value === "medium" ||
		value === "high"
		? value
		: "low";
}

function kind(value: unknown): RunKind | undefined {
	return value === "foreground" ||
		value === "background" ||
		value === "alias" ||
		value === "chain" ||
		value === "parallel"
		? value
		: undefined;
}

function failure(value: unknown): FailureFamily | undefined {
	return value === "spec" || value === "coordination" || value === "verification"
		? value
		: undefined;
}

function usage(value: unknown): SubagentUsage | undefined {
	const raw = obj(value);
	if (!raw) return undefined;
	const input = num(raw.input);
	const output = num(raw.output);
	const cacheRead = num(raw.cacheRead);
	const cacheWrite = num(raw.cacheWrite);
	const cost = num(raw.cost);
	const turns = num(raw.turns);
	if (
		input === undefined ||
		output === undefined ||
		cacheRead === undefined ||
		cacheWrite === undefined ||
		cost === undefined ||
		turns === undefined
	) {
		return undefined;
	}
	return { input, output, cacheRead, cacheWrite, cost, turns };
}

function result(value: unknown): SubagentRunResult | undefined {
	const raw = obj(value);
	if (!raw || typeof raw.text !== "string") return undefined;
	const use = usage(raw.usage);
	if (!use) return undefined;
	const model = typeof raw.model === "string" ? raw.model : undefined;
	const missing = strings(raw.missing);
	return {
		text: raw.text,
		usage: use,
		notes: strings(raw.notes),
		...(model ? { model } : {}),
		...(missing.length > 0 ? { missing } : {}),
	};
}

function subagent(value: unknown, fallbackName: string): SubagentConfig | undefined {
	const raw = obj(value);
	if (!raw) return undefined;
	const name = str(raw.name, fallbackName);
	if (!name) return undefined;
	const tools = Array.isArray(raw.tools) ? strings(raw.tools) : undefined;
	const paths = Array.isArray(raw.paths) ? strings(raw.paths) : undefined;
	const budget = obj(raw.budget);
	return {
		name,
		description: str(raw.description),
		model: str(raw.model, "inherit"),
		autonomy: autonomy(raw.autonomy),
		systemPrompt: str(raw.systemPrompt),
		source: source(raw.source),
		filePath: str(raw.filePath),
		warnings: strings(raw.warnings),
		...(tools && tools.length > 0 ? { tools } : {}),
		...(paths && paths.length > 0 ? { paths } : {}),
		...(budget
			? {
					budget: {
						...(num(budget.maxTurns) !== undefined ? { maxTurns: num(budget.maxTurns) } : {}),
						...(num(budget.maxInputTokens) !== undefined
							? { maxInputTokens: num(budget.maxInputTokens) }
							: {}),
						...(num(budget.timeoutSec) !== undefined ? { timeoutSec: num(budget.timeoutSec) } : {}),
						...(num(budget.maxReportChars) !== undefined
							? { maxReportChars: num(budget.maxReportChars) }
							: {}),
					},
				}
			: {}),
	};
}

function task(value: unknown): TaskRecord | undefined {
	const raw = obj(value);
	if (!raw) return undefined;
	const taskId = str(raw.taskId);
	const subagentName = str(raw.subagentName);
	const cwd = str(raw.cwd);
	const createdAt = num(raw.createdAt);
	const taskStatus = status(raw.status);
	const sub = subagent(raw.subagent, subagentName);
	if (!taskId || !subagentName || !cwd || createdAt === undefined || !taskStatus || !sub) {
		return undefined;
	}
	const steps = decodeSteps(raw.steps);
	const legs = decodeLegs(raw.legs);
	const runKind = kind(raw.kind);
	const runFailure = failure(raw.failure);
	const resultValue = result(raw.result);
	const prompt = typeof raw.prompt === "string" ? raw.prompt : undefined;
	const error = typeof raw.error === "string" ? raw.error : undefined;
	const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : undefined;
	const runId = typeof raw.runId === "string" ? raw.runId : undefined;
	const modelId = typeof raw.modelId === "string" ? raw.modelId : undefined;
	const thinkingLevel = typeof raw.thinkingLevel === "string" ? raw.thinkingLevel : undefined;
	const tools = Array.isArray(raw.tools) ? strings(raw.tools) : undefined;
	const dispatch = obj(raw.dispatch);
	const rule = dispatch ? str(dispatch.rule) : "";
	const matched = dispatch ? str(dispatch.matched) : "";
	return {
		taskId,
		subagentName,
		description: str(raw.description),
		status: taskStatus,
		createdAt,
		fullDelivered: raw.fullDelivered === true,
		subagent: sub,
		cwd,
		history: Array.isArray(raw.history) ? raw.history : [],
		...(num(raw.startedAt) !== undefined ? { startedAt: num(raw.startedAt) } : {}),
		...(num(raw.endedAt) !== undefined ? { endedAt: num(raw.endedAt) } : {}),
		...(num(raw.attempt) !== undefined ? { attempt: num(raw.attempt) } : {}),
		...(resultValue ? { result: resultValue } : {}),
		...(error ? { error } : {}),
		...(runFailure ? { failure: runFailure } : {}),
		...(sessionId ? { sessionId } : {}),
		...(runId ? { runId } : {}),
		...(modelId ? { modelId } : {}),
		...(thinkingLevel ? { thinkingLevel } : {}),
		...(tools && tools.length > 0 ? { tools } : {}),
		...(runKind ? { kind: runKind } : {}),
		...(prompt ? { prompt } : {}),
		...(rule || matched ? { dispatch: { rule, matched } } : {}),
		...(steps && steps.length > 0 ? { steps } : {}),
		...(legs && legs.length > 0 ? { legs } : {}),
	};
}

export function decodeTasks(value: unknown): TaskRecord[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: TaskRecord[] = [];
	for (const item of value) {
		const record = task(item);
		if (!record || seen.has(record.taskId)) continue;
		seen.add(record.taskId);
		out.push(record);
	}
	return out;
}
