/**
 * pi-subagents: live progress for the footer.
 */

import { ActivityLog } from "./activity.ts";
import type { ActivityStep } from "../domain/activity-step.ts";

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
	private sink: ((text: string | undefined) => void) | null = null;

	setSink(fn: (text: string | undefined) => void): void {
		this.sink = fn;
		this.push();
	}

	start(key: string, label: string): void {
		this.entries.set(key, { label, turns: 0, tool: undefined, startedAt: Date.now() });
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

	finish(key: string): void {
		if (!this.entries.delete(key)) return;
		activity.drop(key);
		this.push();
	}

	snapshot(key: string): ProgressSnapshot | undefined {
		const e = this.entries.get(key);
		if (!e) return undefined;
		return {
			turns: e.turns,
			tool: e.tool,
			elapsedSec: Math.max(0, Math.round((Date.now() - e.startedAt) / 1000)),
			partial: e.partial,
		};
	}

	render(): string | undefined {
		const list = [...this.entries.values()];
		const first = list[0];
		if (!first) return undefined;
		if (list.length === 1) {
			const elapsed = formatElapsed(Math.max(0, Math.round((Date.now() - first.startedAt) / 1000)));
			return cut(`⇄ ${first.label} · t${first.turns} · ${elapsed} · ${first.tool ?? "…"}`, 64);
		}
		if (list.length === 2) {
			const second = list[1];
			if (!second) return undefined; // length 2 guarantees it; the check is for the type
			return cut(`⇄ ${first.label} t${first.turns} · ${second.label} t${second.turns}`, 64);
		}
		return cut(
			`⇄ ${list.length} live · ${first.label} t${first.turns} +${list.length - 1} more`,
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
