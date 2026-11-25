/**
 * pi-subagents: live progress for the footer.
 */

import { ActivityLog } from "./activity.ts";
import type { ActivityStep } from "../domain/run/index.ts";

export interface ProgressSnapshot {
	turns: number;
	tool?: string;
	elapsedSec: number;
	partial?: string;
}

interface Entry {
	label: string;
	turns: number;
	tool?: string;
	startedAt: number;
	partial?: string;
}

interface DoneEntry {
	text: string;
	at: number;
}

export interface DoneInfo {
	status: "done" | "error" | "interrupted";
}

export const DONE_TTL_MS = 8_000;
export const DONE_MAX = 3;
const DONE_KEPT = 12;

export function formatElapsed(sec: number): string {
	if (sec < 60) return `${sec}s`;
	return `${Math.floor(sec / 60)}m`;
}

const activity = new ActivityLog();

export function cut(text: string, max: number): string {
	const one = text.replace(/\s+/g, " ").trim();
	return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

export class FooterProgress {
	private entries = new Map<string, Entry>();
	private done: DoneEntry[] = [];
	private waiting = 0;
	private sink: ((text: string | undefined) => void) | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private readonly ttlMs: number;
	private readonly maxDone: number;
	private readonly now: () => number;

	constructor(opts: { ttlMs?: number; maxDone?: number; now?: () => number } = {}) {
		this.ttlMs = opts.ttlMs ?? DONE_TTL_MS;
		this.maxDone = opts.maxDone ?? DONE_MAX;
		this.now = opts.now ?? Date.now;
	}

	setSink(fn: (text: string | undefined) => void): void {
		this.sink = fn;
		this.push();
	}

	start(key: string, label: string): void {
		this.entries.set(key, { label, turns: 0, tool: undefined, startedAt: this.now() });
		this.push();
	}

	note(key: string, text: string): void {
		const e = this.entries.get(key);
		if (!e || !text) return;
		e.partial = text;
		this.push();
	}

	turn(key: string): void {
		const e = this.entries.get(key);
		if (!e) return;
		e.turns += 1;
		this.push();
	}

	step(key: string, step: ActivityStep): void {
		const e = this.entries.get(key);
		if (!e) return;
		e.tool = step.tool;
		activity.push(key, step);
		this.push();
	}

	recent(key: string): ActivityStep[] {
		return activity.recent(key);
	}

	finish(key: string, final?: DoneInfo): void {
		const entry = this.entries.get(key);
		if (!entry) return;
		this.entries.delete(key);
		activity.drop(key);
		if (final) this.remember(entry, final);
		this.push();
	}

	clearDone(): void {
		this.done = [];
		this.stopTimer();
		this.push();
	}

	/** Rows that wait for a live slot; they have no start time yet. */
	setWaiting(count: number): void {
		const next = Math.max(0, Math.round(count));
		if (next === this.waiting) return;
		this.waiting = next;
		this.push();
	}

	private remember(entry: Entry, final: DoneInfo): void {
		const elapsed = Math.max(0, Math.round((this.now() - entry.startedAt) / 1000));
		const glyph = final.status === "error" ? "✗" : final.status === "interrupted" ? "⊘" : "✓";
		this.done.unshift({
			text: `${glyph} ${entry.label} ${formatElapsed(elapsed)}`,
			at: this.now(),
		});
		if (this.done.length > DONE_KEPT) this.done.length = DONE_KEPT;
		this.schedule();
	}

	private prune(now = this.now()): void {
		const before = this.done.length;
		this.done = this.done.filter((d) => now - d.at < this.ttlMs);
		if (this.done.length !== before) this.push();
		this.schedule();
	}

	private schedule(): void {
		this.stopTimer();
		const oldest = this.done[this.done.length - 1];
		if (!oldest) return;
		const wait = Math.max(0, this.ttlMs - (this.now() - oldest.at));
		const timer = setTimeout(() => {
			this.timer = null;
			this.prune();
		}, wait) as ReturnType<typeof setTimeout> & { unref?: () => void };
		timer.unref?.();
		this.timer = timer;
	}

	private stopTimer(): void {
		if (!this.timer) return;
		clearTimeout(this.timer);
		this.timer = null;
	}

	snapshot(key: string): ProgressSnapshot | undefined {
		const e = this.entries.get(key);
		if (!e) return undefined;
		return {
			turns: e.turns,
			tool: e.tool,
			elapsedSec: Math.max(0, Math.round((this.now() - e.startedAt) / 1000)),
			partial: e.partial,
		};
	}

	render(now = this.now()): string | undefined {
		const done = this.done.filter((d) => now - d.at < this.ttlMs);
		const doneText = done.length > 0 ? this.doneText(done) : undefined;
		const liveText = this.liveText();
		if (!doneText) return liveText;
		if (!liveText) return doneText;
		return cut(`${doneText} · ${liveText}`, 64);
	}

	private doneText(list: DoneEntry[]): string {
		const total = list.length;
		const shown = Math.min(this.maxDone, total);
		for (let count = shown; count >= 1; count -= 1) {
			const rest = total - count;
			const more = rest > 0 ? ` +${rest}` : "";
			const text = `${list
				.slice(0, count)
				.map((d) => d.text)
				.join(" · ")}${more}`;
			if (text.length <= 64) return text;
		}
		const first = list[0]?.text ?? "";
		return cut(total > 1 ? `${first} +${total - 1}` : first, 64);
	}

	private liveText(): string | undefined {
		const list = [...this.entries.values()];
		const first = list[0];
		const queue = this.waiting > 0 ? `${this.waiting} queued` : "";
		const tail = queue ? ` · ${queue}` : "";
		if (!first) return queue ? `⇄ ${queue}` : undefined;
		if (list.length === 1) {
			const elapsed = formatElapsed(Math.max(0, Math.round((this.now() - first.startedAt) / 1000)));
			return cut(
				`⇄ ${first.label} · t${first.turns} · ${elapsed} · ${first.tool ?? "…"}${tail}`,
				64,
			);
		}
		if (list.length === 2) {
			const second = list[1];
			if (!second) return undefined; // length 2 guarantees it; the check is for the type
			return cut(`⇄ ${first.label} t${first.turns} · ${second.label} t${second.turns}${tail}`, 64);
		}
		return cut(
			`⇄ ${list.length} live · ${first.label} t${first.turns} +${list.length - 1} more${tail}`,
			64,
		);
	}

	private push(): void {
		if (!this.sink) return;
		try {
			this.sink(this.render());
		} catch {
			/* progress is cosmetic; never break a run */
		}
	}
}

export const footerProgress = new FooterProgress();

/** Point the tracker at a Pi footer. Safe to call per tool call. */

export function useFooterUI(ui: { setStatus(key: string, text: string | undefined): void }): void {
	footerProgress.setSink((text) => {
		try {
			ui.setStatus("pi-subagents", text);
		} catch {
			/* progress is cosmetic */
		}
	});
}
