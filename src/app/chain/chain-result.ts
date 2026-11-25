/**
 * pi-subagents: one report and usage total for a finished chain.
 */

import type { SubagentRunResult } from "../../domain/run/index.ts";
import type { TaskRecord } from "../../domain/task/index.ts";

export function aggregateResult(steps: SubagentRunResult[], rec: TaskRecord): SubagentRunResult {
	const usage = steps.reduce<SubagentRunResult["usage"]>(
		(acc, s) => ({
			input: acc.input + s.usage.input,
			output: acc.output + s.usage.output,
			cacheRead: acc.cacheRead + s.usage.cacheRead,
			cacheWrite: acc.cacheWrite + s.usage.cacheWrite,
			cost: acc.cost + s.usage.cost,
			turns: acc.turns + s.usage.turns,
		}),
		{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
	);
	const notes = steps.flatMap((s) => s.notes);
	const model = steps[steps.length - 1]?.model;
	const sections = (rec.steps ?? [])
		.filter((s) => s.status === "done" && s.report)
		.map((s) => `### ${s.idx + 1}. ${s.subagentName}\n${s.report}`);
	return {
		text: sections.join("\n\n") || "(chain produced no report)",
		usage,
		model,
		notes,
	};
}
