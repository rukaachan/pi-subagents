/**
 * pi-subagents: per-subagent handoff economics.
 */
import type { JournalRun } from "./journal-run.ts";

export interface HandoffRow {
	subagent: string;
	runs: number;
	done: number;
	error: number;
	stopped: number;
	p50Turns: number | null;
	p50InputTokens: number | null;
	p50ReportChars: number | null;
	charsPer1k: number | null;
	noUsage: number;
}

export function p50(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = values.toSorted((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[mid] ?? null;
	const a = sorted[mid - 1];
	const b = sorted[mid];
	return a === undefined || b === undefined ? null : Math.round((a + b) / 2);
}

export function handoffRows(runs: JournalRun[]): HandoffRow[] {
	const groups = new Map<string, JournalRun[]>();
	for (const run of runs) {
		const name = run.label.split(" ")[0] || run.label;
		const group = groups.get(name);
		if (group) group.push(run);
		else groups.set(name, [run]);
	}
	return [...groups.entries()]
		.map(([subagent, rows]) => {
			const input = rows.flatMap((run) => (run.inputTokens === undefined ? [] : [run.inputTokens]));
			const report = rows.flatMap((run) =>
				run.reportChars === undefined ? [] : [run.reportChars],
			);
			const inputTotal = input.reduce((sum, value) => sum + value, 0);
			const reportTotal = report.reduce((sum, value) => sum + value, 0);
			return {
				subagent,
				runs: rows.length,
				done: rows.filter((run) => run.status === "done").length,
				error: rows.filter((run) => run.status === "error").length,
				stopped: rows.filter((run) => run.status === "interrupted").length,
				p50Turns: p50(rows.map((run) => run.turns)),
				p50InputTokens: p50(input),
				p50ReportChars: p50(report),
				charsPer1k: inputTotal > 0 ? Math.round((reportTotal / inputTotal) * 1000) : null,
				noUsage: rows.filter((run) => run.inputTokens === undefined).length,
			};
		})
		.toSorted((a, b) => a.subagent.localeCompare(b.subagent));
}
