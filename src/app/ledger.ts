/**
 * pi-subagents: spawn counts.
 */
import type { RunKind, SpawnCounts } from "../domain/task.ts";

export type { SpawnCounts } from "../domain/task.ts";

export interface RunLedger {
	begin(subagentName: string): void;
	finish(subagentName: string, status: "done" | "error" | "stopped"): void;
	total(name?: string): number;
	bySubagent(): Record<string, SpawnCounts>;
}

export class InMemoryLedger implements RunLedger {
	private counts = new Map<string, SpawnCounts>();

	private row(name: string): SpawnCounts {
		let row = this.counts.get(name);
		if (!row) {
			row = {
				total: 0,
				running: 0,
				done: 0,
				error: 0,
				stopped: 0,
				foreground: 0,
				background: 0,
				alias: 0,
			};
			this.counts.set(name, row);
		}
		return row;
	}

	begin(subagentName: string): void {
		const row = this.row(subagentName);
		row.total += 1;
		row.running += 1;
	}

	finish(subagentName: string, status: "done" | "error" | "stopped"): void {
		const row = this.row(subagentName);
		if (row.running > 0) row.running -= 1;
		if (status === "done") row.done += 1;
		else if (status === "stopped") row.stopped = (row.stopped ?? 0) + 1;
		else row.error += 1;
	}

	bumpKind(name: string, kind: RunKind): void {
		if (kind === "chain" || kind === "parallel") this.row(name).background += 1;
		else this.row(name)[kind] += 1;
	}

	total(name?: string): number {
		if (name) return this.counts.get(name)?.total ?? 0;
		let n = 0;
		for (const row of this.counts.values()) n += row.total;
		return n;
	}

	bySubagent(): Record<string, SpawnCounts> {
		const out: Record<string, SpawnCounts> = {};
		for (const [name, row] of this.counts) out[name] = { ...row };
		return out;
	}

	/** Replace all counts (restore). Older files have no `stopped` key. */
	restore(rows: Record<string, SpawnCounts>): void {
		this.counts.clear();
		for (const [name, row] of Object.entries(rows)) {
			this.counts.set(name, { ...row, stopped: row.stopped ?? 0 });
		}
	}

	clearRunning(): void {
		for (const row of this.counts.values()) row.running = 0;
	}
}

export const ledger = new InMemoryLedger();

export function markKind(name: string, kind: RunKind): void {
	(ledger as InMemoryLedger).bumpKind(name, kind);
}
