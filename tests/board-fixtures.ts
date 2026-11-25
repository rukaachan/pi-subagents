/**
 * Shared fixtures for the board tests.
 */
import { buildBoard } from "../src/ui/view/board-model.ts";
import type { TaskRecord } from "../src/domain/task/index.ts";
import type { SubagentConfig } from "../src/domain/subagent/index.ts";

export function sub(name = "worker"): SubagentConfig {
	return {
		name,
		description: "",
		model: "inherit",
		autonomy: "inherit",
		systemPrompt: "",
		source: "user",
		filePath: "",
		warnings: [],
	};
}

export function rec(over: Partial<TaskRecord> = {}): TaskRecord {
	return {
		taskId: "task-1",
		subagentName: "worker",
		description: "map the engine",
		status: "running",
		createdAt: 1_000,
		fullDelivered: false,
		subagent: sub(),
		cwd: "/tmp",
		history: [],
		...over,
	};
}

export function usage(turns: number, input: number, cost: number) {
	return { turns, input, output: 0, cacheRead: 0, cacheWrite: 0, cost };
}

export function plainTheme() {
	return { fg: (_token: string, text: string) => text, bold: (text: string) => text };
}

export function board(rows: TaskRecord[], live: string[] = [], now = 10_000) {
	const seen = new Set(live);
	return buildBoard(rows, { now, live: (id) => seen.has(id) });
}
