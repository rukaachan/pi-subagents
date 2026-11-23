/**
 * pi-subagents: the viewer tabs and what each one keeps.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TranscriptEntry } from "../../telemetry/transcript.ts";

export type SessionTab = "transcript" | "tools" | "errors";

export const TAB_KEYS: Readonly<Record<string, SessionTab>> = {
	"1": "transcript",
	"2": "tools",
	"3": "errors",
};

const TAB_ORDER: readonly SessionTab[] = ["transcript", "tools", "errors"];
const TAB_LABEL: Record<SessionTab, string> = {
	transcript: "transcript",
	tools: "tools",
	errors: "errors",
};

export function filterEntries(
	entries: readonly TranscriptEntry[],
	tab: SessionTab,
): TranscriptEntry[] {
	if (tab === "tools") return entries.filter((e) => e.kind === "tool" || e.kind === "result");
	if (tab === "errors") return entries.filter((e) => e.kind === "error");
	return [...entries];
}

export function tabBar(
	tab: SessionTab,
	entries: readonly TranscriptEntry[],
	theme: Pick<Theme, "fg" | "bold">,
): string {
	const parts = TAB_ORDER.map((id, index) => {
		const count = filterEntries(entries, id).length;
		const text = `${index + 1} ${TAB_LABEL[id]}${count > 0 ? ` ${count}` : ""}`;
		return id === tab ? theme.bold(theme.fg("accent", text)) : theme.fg("muted", text);
	});
	return ` ${parts.join(theme.fg("borderMuted", " · "))}`;
}

export function nextError(entries: readonly TranscriptEntry[], from: number): number {
	for (let i = from + 1; i < entries.length; i += 1) {
		if (entries[i]?.kind === "error") return i;
	}
	for (let i = 0; i <= from && i < entries.length; i += 1) {
		if (entries[i]?.kind === "error") return i;
	}
	return -1;
}

export function tabText(entries: readonly TranscriptEntry[]): string {
	return entries.map((e) => (e.text ? `${e.label}  ${e.text}` : e.label)).join("\n");
}

export interface TabStateDeps {
	all: () => readonly TranscriptEntry[];
	theme: Pick<Theme, "fg" | "bold">;
	render: () => void;
	onCopy?: (text: string) => void;
	reset: () => void;
	jump: (line: number) => void;
	lineOf: (index: number) => number;
}

export interface TabState {
	tab: () => SessionTab;
	entries: () => TranscriptEntry[];
	bar: () => string;
	note: () => string;
	select: (next: SessionTab) => void;
	error: () => void;
	copy: () => void;
	dispose: () => void;
}

export function createTabState(deps: TabStateDeps): TabState {
	let tab: SessionTab = "transcript";
	let lastError = -1;
	let note = "";
	let timer: ReturnType<typeof setTimeout> | undefined;
	const entries = () => filterEntries(deps.all(), tab);

	function select(next: SessionTab): void {
		if (next === tab) return;
		tab = next;
		lastError = -1;
		deps.reset();
		deps.render();
	}

	return {
		tab: () => tab,
		entries,
		bar: () => tabBar(tab, deps.all(), deps.theme),
		note: () => note,
		select,
		error(): void {
			const found = nextError(entries(), lastError);
			if (found < 0) {
				if (tab !== "errors") select("errors");
				return;
			}
			lastError = found;
			deps.jump(deps.lineOf(found));
		},
		copy(): void {
			const text = tabText(entries());
			if (!text) return;
			deps.onCopy?.(text);
			note = "copied";
			deps.render();
			if (timer !== undefined) clearTimeout(timer);
			timer = setTimeout(() => {
				note = "";
				deps.render();
			}, 1500);
			timer.unref?.();
		},
		dispose(): void {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
		},
	};
}
