/**
 * pi-subagents: the mission-control Runs screen, one card per run.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
	cardLines,
	duration,
	fitHint,
	screenHeader,
	stackLines,
	tabsLine,
	tokenCount,
	type StackItem,
} from "../design/index.ts";
import { boardHint, type HiddenRows } from "./board-hint.ts";
import type { BoardRow, BoardSection } from "./board-model.ts";

export interface BoardRender {
	width: number;
	height: number;
	cursor: number;
	theme: Pick<Theme, "fg" | "bold">;
	agentTeam?: { open: number; done: number; enabled: boolean };
	/** Stopped and failed runs stay collapsed until the user asks for them. */
	hidden?: HiddenRows;
}

export interface BoardBody {
	width: number;
	height: number;
	cursor: number;
	theme: Pick<Theme, "fg" | "bold">;
	hidden?: HiddenRows;
}

const SECTION_TITLE: Record<BoardSection, string> = {
	queued: "QUEUED",
	running: "RUNNING",
	done: "DONE",
	stopped: "STOPPED",
	failed: "FAILED",
};

export function boardSummary(rows: readonly BoardRow[], hidden?: HiddenRows): string {
	const live = rows.filter((row) => row.section === "running" || row.section === "queued").length;
	const done = rows.filter((row) => row.section === "done").length;
	const failed = hidden?.failed ?? rows.filter((row) => row.section === "failed").length;
	const stopped = hidden?.stopped ?? rows.filter((row) => row.section === "stopped").length;
	if (rows.length === 0 && failed + stopped === 0) return "no runs yet";
	const parts: string[] = [];
	if (live > 0) parts.push(live + " running");
	if (done > 0) parts.push(done + " done");
	if (stopped > 0) parts.push(stopped + " stopped");
	if (failed > 0) parts.push(failed + " failed");
	return parts.join(" · ") || "no runs yet";
}

/** Header, tabs, blank, cards, and the hint: the whole standalone screen. */
export function boardHeight(rows: readonly BoardRow[]): number {
	if (rows.length === 0) return 9;
	const sections = new Set(rows.map((row) => row.section)).size;
	return 3 + sections + 5 * rows.length;
}

function subtitle(row: BoardRow): string {
	const parts: string[] = [];
	if (row.label) parts.push(row.label);
	if (row.section === "queued") {
		parts.push("waiting for a slot");
	} else {
		if (row.turns > 0) parts.push(row.turns + "t");
		const tokens = tokenCount(row.tokens);
		if (tokens) parts.push(tokens);
		if (row.cost) parts.push("$" + row.cost.toFixed(3));
	}
	if (row.failure) parts.push("!" + row.failure);
	return parts.join(" · ");
}

function emptyCard(
	hidden: HiddenRows | undefined,
	width: number,
	theme: BoardBody["theme"],
): string[] {
	const total = hidden ? hidden.failed + hidden.stopped : 0;
	if (total > 0) {
		return cardLines({
			width,
			theme,
			tone: "muted",
			glyph: "·",
			title: "No visible runs",
			subtitle: "Press e to show " + total + " hidden.",
		});
	}
	return cardLines({
		width,
		theme,
		status: "queued",
		tone: "muted",
		title: "No runs yet",
		subtitle: "Press enter to run something.",
		detail: "Or /subagents new to create a subagent.",
	});
}

function boardItems(
	rows: readonly BoardRow[],
	width: number,
	theme: BoardBody["theme"],
	cursor: number,
): StackItem[] {
	return rows.map((row, index) => ({
		section: SECTION_TITLE[row.section],
		lines: cardLines({
			width,
			theme,
			selected: index === cursor,
			status: row.section,
			title: row.name,
			meta: row.section === "queued" ? "waiting" : duration(row.elapsedSec),
			subtitle: subtitle(row),
		}),
	}));
}

export function renderBoardBody(rows: readonly BoardRow[], opts: BoardBody): string[] {
	const height = Math.max(1, opts.height);
	const cursor = rows.length === 0 ? 0 : Math.max(0, Math.min(opts.cursor, rows.length - 1));
	const out =
		rows.length === 0
			? emptyCard(opts.hidden, opts.width, opts.theme)
			: stackLines(boardItems(rows, opts.width, opts.theme, cursor), cursor, height, opts.theme);
	while (out.length < height) out.push("");
	return out.slice(0, height);
}

export function renderBoard(rows: BoardRow[], opts: BoardRender): string[] {
	const { width, height, theme } = opts;
	const cursor = rows.length === 0 ? 0 : Math.max(0, Math.min(opts.cursor, rows.length - 1));
	const bodyHeight = Math.max(1, height - 4);
	const team = opts.agentTeam ? " · team " + opts.agentTeam.open + " open" : "";
	const out = [
		screenHeader("pi-subagents", boardSummary(rows, opts.hidden) + team, width, theme),
		tabsLine(["RUNS", "AGENT TEAM"], 0, width, theme),
		"",
		...renderBoardBody(rows, {
			width,
			height: bodyHeight,
			cursor,
			theme,
			...(opts.hidden ? { hidden: opts.hidden } : {}),
		}),
		fitHint(boardHint(rows, cursor, opts.hidden), width, theme),
	];
	return out.slice(0, Math.max(1, height)).map((line) => truncateToWidth(line, width, ""));
}

export type BoardAction =
	| { kind: "open"; taskId: string }
	| { kind: "steer"; taskId: string }
	| { kind: "stop"; taskId: string }
	| { kind: "retry"; taskId: string }
	| { kind: "copy"; taskId: string }
	| { kind: "close" };

export interface BoardViewDeps {
	rows: () => BoardRow[];
	agentTeam?: () => { open: number; done: number; enabled: boolean };
	height: () => number;
	theme: BoardRender["theme"];
	render: () => void;
	onAction: (action: BoardAction) => void;
	subscribe?: (fn: () => void) => () => void;
	poll?: boolean;
	alive?: () => boolean;
}

export interface BoardView {
	render: (width: number) => string[];
	handleInput: (data: string) => void;
	sync: () => void;
	dispose: () => void;
}

const POLL_MS = 1000;

function versionOf(rows: BoardRow[], cursor: number): string {
	return (
		cursor +
		"|" +
		rows
			.map(
				(row) =>
					row.taskId +
					":" +
					row.section +
					":" +
					row.turns +
					":" +
					row.elapsedSec +
					":" +
					row.tokens,
			)
			.join("|")
	);
}

export function createBoardView(deps: BoardViewDeps): BoardView {
	let cursor = 0;
	let closed = false;
	let lastKey = "";
	let timer: ReturnType<typeof setInterval> | undefined;
	const unsubscribe = deps.subscribe?.(() => sync());
	if (deps.poll) {
		timer = setInterval(() => sync(), POLL_MS);
		timer.unref?.();
	}

	function current(): BoardRow | undefined {
		return deps.rows()[cursor];
	}

	function emit(action: BoardAction): void {
		if (closed) return;
		closed = true;
		deps.onAction(action);
	}

	function move(delta: number): void {
		const count = deps.rows().length;
		if (count === 0) return;
		cursor = Math.max(0, Math.min(cursor + delta, count - 1));
		sync();
	}

	function sync(): void {
		if (closed) return;
		if (deps.alive && !deps.alive()) return;
		const key = versionOf(deps.rows(), cursor);
		if (key === lastKey) return;
		lastKey = key;
		deps.render();
	}

	return {
		render(width: number): string[] {
			const rows = deps.rows();
			cursor = rows.length === 0 ? 0 : Math.max(0, Math.min(cursor, rows.length - 1));
			lastKey = versionOf(rows, cursor);
			return renderBoard(rows, {
				width,
				height: deps.height(),
				cursor,
				theme: deps.theme,
				...(deps.agentTeam ? { agentTeam: deps.agentTeam() } : {}),
			});
		},

		handleInput(data: string): void {
			if (closed) return;
			const row = current();
			if (matchesKey(data, Key.escape) || data === "\x03") return emit({ kind: "close" });
			if (matchesKey(data, Key.up) || data === "k") return move(-1);
			if (matchesKey(data, Key.down) || data === "j") return move(1);
			if (data === "g") {
				cursor = 0;
				return sync();
			}
			if (data === "G") {
				cursor = Math.max(0, deps.rows().length - 1);
				return sync();
			}
			if (!row) return;
			if (matchesKey(data, Key.enter) && row.openable)
				return emit({ kind: "open", taskId: row.taskId });
			if (data === "s" && row.steerable) return emit({ kind: "steer", taskId: row.taskId });
			if (data === "x" && row.stoppable) return emit({ kind: "stop", taskId: row.taskId });
			if (data === "r" && row.retryable) return emit({ kind: "retry", taskId: row.taskId });
			if (data === "c") return emit({ kind: "copy", taskId: row.taskId });
		},

		sync,

		dispose(): void {
			closed = true;
			if (timer) clearInterval(timer);
			timer = undefined;
			unsubscribe?.();
		},
	};
}
