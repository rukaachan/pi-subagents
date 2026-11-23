/**
 * pi-subagents: the mission-control board screen and its keys.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { rowLine, type BoardRow, type BoardSection } from "./board-model.ts";
import { detailLines } from "./board-detail.ts";

export interface BoardRender {
	width: number;
	height: number;
	cursor: number;
	theme: Pick<Theme, "fg" | "bold">;
	team?: { open: number; done: number; enabled: boolean };
}

interface Line {
	kind: "section" | "group" | "row";
	text: string;
	row?: number;
}

const SECTION_TITLE: Record<BoardSection, string> = {
	queued: "QUEUED",
	running: "RUNNING",
	done: "DONE",
	failed: "FAILED",
};

/** Header, rules, hint, section and run headings, then one line per row. */
export function boardHeight(rows: readonly BoardRow[]): number {
	let height = 4;
	let section: BoardSection | undefined;
	let runId: string | undefined;
	for (const row of rows) {
		if (row.section !== section) {
			section = row.section;
			runId = undefined;
			height += 1;
		}
		if (row.runId && row.runId !== runId) {
			runId = row.runId;
			height += 1;
		}
		height += 1;
	}
	return height;
}

function displayLines(
	rows: BoardRow[],
	width: number,
	cursor: number,
	theme: BoardRender["theme"],
): Line[] {
	const out: Line[] = [];
	let section: BoardSection | undefined;
	let runId: string | undefined;
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i];
		if (!row) continue;
		if (row.section !== section) {
			section = row.section;
			runId = undefined;
			out.push({ kind: "section", text: theme.fg("muted", SECTION_TITLE[section]) });
		}
		if (row.runId && row.runId !== runId) {
			runId = row.runId;
			const count = rows.filter((r) => r.section === row.section && r.runId === runId).length;
			out.push({
				kind: "group",
				text: theme.fg("dim", `  ── run · ${count} leg${count === 1 ? "" : "s"}`),
			});
		}
		out.push({ kind: "row", text: rowLine(row, i === cursor, width, theme), row: i });
	}
	return out;
}

export function renderBoard(rows: BoardRow[], opts: BoardRender): string[] {
	const { width, height, theme } = opts;
	const bodyRows = Math.max(1, height - 4);
	const cursor = rows.length === 0 ? 0 : Math.max(0, Math.min(opts.cursor, rows.length - 1));
	const wide = width >= 96;
	const listWidth = wide ? Math.min(74, Math.max(56, Math.floor(width * 0.62))) : width;
	const detailWidth = width - listWidth - 3;
	const lines = displayLines(rows, listWidth, cursor, theme);
	const selected = lines.findIndex((line) => line.row === cursor);
	let top = 0;
	if (selected >= 0 && lines.length > bodyRows) {
		top = Math.max(0, Math.min(selected - Math.floor(bodyRows / 2), lines.length - bodyRows));
	}
	const shown = lines.slice(top, top + bodyRows).map((line) => line.text);
	while (shown.length < bodyRows) shown.push("");
	const details = wide ? detailLines(rows[cursor], detailWidth, theme) : [];
	const body = shown.map((line, index) => {
		if (!wide) return line;
		const clipped = truncateToWidth(line, listWidth, "…");
		const pad = " ".repeat(Math.max(0, listWidth - visibleWidth(clipped)));
		const detail = truncateToWidth(details[index] ?? "", detailWidth, "…");
		return `${clipped}${pad}${theme.fg("borderMuted", " │ ")}${detail}`;
	});
	const live = rows.filter((r) => r.section === "running" || r.section === "queued").length;
	const done = rows.filter((r) => r.section === "done").length;
	const failed = rows.filter((r) => r.section === "failed").length;
	const counts = `${live} live · ${done} done · ${failed} failed`;
	const team = opts.team ? ` · team ${opts.team.open} open` : "";
	const title = `${theme.bold("Mission control")}  ${theme.fg("muted", counts + team)}`;
	const rule = theme.fg("borderMuted", "─".repeat(Math.max(1, width)));
	const hint = theme.fg(
		"dim",
		`↑↓ move · tab team · f finish · enter open · s steer · x stop · r retry · c copy · esc back · ${rows.length === 0 ? "0/0" : `${cursor + 1}/${rows.length}`}`,
	);
	const out = [
		truncateToWidth(title, width, "…"),
		rule,
		...body,
		rule,
		truncateToWidth(hint, width, "…"),
	];
	return out.map((line) => truncateToWidth(line, width, ""));
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
	team?: () => { open: number; done: number; enabled: boolean };
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
	return `${cursor}|${rows.map((r) => `${r.taskId}:${r.section}:${r.turns}:${r.elapsedSec}:${r.tokens}`).join("|")}`;
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
				...(deps.team ? { team: deps.team() } : {}),
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
