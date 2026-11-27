/**
 * pi-subagents: lays out cards in sections and keeps the cursor on screen.
 */

import { sectionLine } from "./header.ts";
import type { UiTheme } from "./tokens.ts";

export interface StackItem {
	section: string;
	lines: string[];
}

export function stackHeight(items: readonly StackItem[]): number {
	if (items.length === 0) return 0;
	const sections = new Set(items.map((item) => item.section)).size;
	const lines = items.reduce((sum, item) => sum + item.lines.length, 0);
	return sections + items.length - 1 + lines;
}

export function stackLines(
	items: readonly StackItem[],
	cursor: number,
	height: number,
	theme: UiTheme,
): string[] {
	if (items.length === 0 || height <= 0) return [];
	const counts = new Map<string, number>();
	for (const item of items) counts.set(item.section, (counts.get(item.section) ?? 0) + 1);
	const target = Math.max(0, Math.min(cursor, items.length - 1));
	let take = Math.min(items.length, Math.max(1, Math.floor((height + 1) / 5)));
	let gaps = true;
	for (;;) {
		const top = Math.max(0, Math.min(target - Math.floor(take / 2), items.length - take));
		const out: string[] = [];
		let section = "";
		for (let i = top; i < top + take; i += 1) {
			const item = items[i];
			if (!item) continue;
			if (item.section !== section) {
				if (out.length > 0) out.push("");
				out.push(sectionLine(item.section, counts.get(item.section) ?? 0, theme));
				section = item.section;
			} else if (gaps) {
				out.push("");
			}
			out.push(...item.lines);
		}
		if (out.length <= height) return out;
		if (gaps) {
			gaps = false;
			continue;
		}
		if (take <= 1) return out.slice(0, height);
		take -= 1;
		gaps = true;
	}
}
