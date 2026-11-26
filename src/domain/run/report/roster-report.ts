/**
 * pi-subagents: measure rosters from the folded journal.
 */

export interface RosterRun {
	id: string;
	runId?: string;
	status: "running" | "done" | "error" | "interrupted";
	turns: number;
	promptChars?: number;
	reportChars?: number;
	inputTokens?: number;
	startedAt: number;
}

export interface RosterBucket {
	label: string;
	runs: number;
	avgInputTokens: number;
}

export interface RosterSize {
	size: number;
	groups: number;
	successRate: number;
}

export interface RosterReport {
	runs: number;
	groups: number;
	context: RosterBucket[];
	handoffTax?: number;
	bySize: RosterSize[];
	recommendation?: number;
}

const BUCKETS = [
	{ label: "0-4", min: 0, max: 4 },
	{ label: "5-9", min: 5, max: 9 },
	{ label: "10-19", min: 10, max: 19 },
	{ label: "20+", min: 20, max: Number.POSITIVE_INFINITY },
];

function groupKey(run: RosterRun): string {
	return run.runId ?? run.id;
}

function average(values: number[]): number | undefined {
	if (values.length === 0) return undefined;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizeRoster(runs: readonly RosterRun[]): RosterReport {
	const groups = new Map<string, RosterRun[]>();
	for (const run of runs) {
		const key = groupKey(run);
		const list = groups.get(key) ?? [];
		list.push(run);
		groups.set(key, list);
	}
	const context: RosterBucket[] = [];
	for (const bucket of BUCKETS) {
		const inside = runs.filter((run) => {
			const turns = Math.max(0, Math.floor(run.turns));
			return turns >= bucket.min && turns <= bucket.max;
		});
		if (inside.length === 0) continue;
		const avg = average(inside.map((run) => run.inputTokens ?? 0)) ?? 0;
		context.push({ label: bucket.label, runs: inside.length, avgInputTokens: Math.round(avg) });
	}
	const ratios: number[] = [];
	for (const list of groups.values()) {
		const sorted = [...list].toSorted((a, b) => a.startedAt - b.startedAt);
		for (let i = 1; i < sorted.length; i += 1) {
			const prior = sorted[i - 1];
			const next = sorted[i];
			if (!prior || !next || !prior.reportChars || next.promptChars === undefined) continue;
			ratios.push(next.promptChars / prior.reportChars);
		}
	}
	const bySize: RosterSize[] = [];
	for (const list of groups.values()) {
		const size = new Set(list.map((run) => run.id)).size;
		const existing = bySize.find((entry) => entry.size === size);
		if (existing) {
			existing.groups += 1;
		} else {
			bySize.push({ size, groups: 1, successRate: 0 });
		}
	}
	for (const row of bySize) {
		const list = [...groups.values()].filter(
			(group) => new Set(group.map((run) => run.id)).size === row.size,
		);
		const wins = list.filter((group) => group.every((run) => run.status === "done")).length;
		row.successRate = list.length === 0 ? 0 : wins / list.length;
	}
	bySize.sort((a, b) => a.size - b.size);
	const best = bySize.reduce((max, row) => Math.max(max, row.successRate), 0);
	const recommendation = bySize.find((row) => row.successRate >= Math.max(0, best - 0.1))?.size;
	const handoffTax = average(ratios);
	return {
		runs: runs.length,
		groups: groups.size,
		context,
		...(handoffTax !== undefined ? { handoffTax } : {}),
		bySize,
		...(recommendation !== undefined ? { recommendation } : {}),
	};
}
