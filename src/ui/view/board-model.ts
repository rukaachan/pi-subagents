/**
 * pi-subagents: the rows behind the mission-control board.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { FailureFamily } from "../../domain/policy/index.ts";
import type { TaskRecord } from "../../domain/task/index.ts";
import { lastMessageAt } from "../../domain/task/index.ts";
import { shortText } from "./format.ts";

export type BoardSection = "queued" | "running" | "done" | "stopped" | "failed";

export interface BoardRow {
	taskId: string;
	name: string;
	/** What this run is doing, trimmed from its description. */
	label: string;
	section: BoardSection;
	status: TaskRecord["status"];
	runId?: string;
	createdAt: number;
	turns: number;
	elapsedSec: number;
	tokens: number;
	cost?: number;
	failure?: FailureFamily;
	openable: boolean;
	steerable: boolean;
	stoppable: boolean;
	retryable: boolean;
}

export interface BoardDeps {
	now?: number;
	live?: (taskId: string) => boolean;
}

const SECTION_ORDER: Record<BoardSection, number> = {
	queued: 0,
	running: 1,
	done: 2,
	stopped: 3,
	failed: 4,
};

export function boardSection(rec: TaskRecord): BoardSection {
	if (rec.status === "error") return "failed";
	if (rec.status === "done") return "done";
	if (rec.status === "stopped") return "stopped";
	return rec.startedAt === undefined ? "queued" : "running";
}

export function buildBoard(records: readonly TaskRecord[], deps: BoardDeps = {}): BoardRow[] {
	const now = deps.now ?? Date.now();
	const live = deps.live ?? (() => false);
	const rows = records.map((rec): BoardRow => {
		const section = boardSection(rec);
		const usage = rec.result?.usage;
		const start = rec.startedAt ?? rec.createdAt;
		const end =
			rec.endedAt ?? lastMessageAt(rec.history) ?? (rec.status === "running" ? now : start);
		const isLive = live(rec.taskId);
		return {
			taskId: rec.taskId,
			name: rowName(rec),
			label: shortText(rec.description, 34),
			section,
			status: rec.status,
			...(rec.runId ? { runId: rec.runId } : {}),
			createdAt: rec.createdAt,
			turns: usage?.turns ?? 0,
			elapsedSec: Math.max(0, Math.round((end - start) / 1000)),
			tokens: usage ? usage.input + usage.output : 0,
			...(usage && usage.cost > 0 ? { cost: usage.cost } : {}),
			...(rec.failure ? { failure: rec.failure } : {}),
			openable: rec.kind !== "chain",
			steerable: section === "running" && isLive,
			stoppable: section === "running" && isLive,
			retryable: section === "failed" && !!rec.prompt,
		};
	});
	return rows.toSorted((a, b) => {
		const bySection = SECTION_ORDER[a.section] - SECTION_ORDER[b.section];
		if (bySection !== 0) return bySection;
		const byRun = (a.runId ?? "").localeCompare(b.runId ?? "");
		if (byRun !== 0) return byRun;
		return a.createdAt - b.createdAt;
	});
}

function rowName(rec: TaskRecord): string {
	if (rec.kind === "chain" && rec.steps && rec.steps.length > 0) {
		return rec.steps.map((step) => step.subagentName).join("→");
	}
	if (rec.kind === "parallel" && rec.legs && rec.legs.length > 1) {
		return rec.legs.map((leg) => leg.subagentName).join("⇉");
	}
	return rec.subagentName;
}

const GLYPH: Record<BoardSection, string> = {
	queued: "○",
	running: "…",
	done: "✓",
	stopped: "⊘",
	failed: "✗",
};

function tokens(n: number): string {
	if (n <= 0) return "";
	if (n < 1000) return `${n}tok`;
	return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}ktok`;
}

export function rowLine(
	row: BoardRow,
	selected: boolean,
	width: number,
	theme: Pick<Theme, "fg">,
): string {
	const marker = selected ? theme.fg("accent", "› ") : "  ";
	const glyph = theme.fg(
		row.section === "failed"
			? "error"
			: row.section === "done"
				? "success"
				: row.section === "stopped"
					? "dim"
					: "warning",
		GLYPH[row.section],
	);
	const name = selected ? theme.fg("accent", row.name) : row.name;
	const label = row.label ? theme.fg("dim", ` · ${row.label}`) : "";
	const bits: string[] = [];
	if (row.section === "queued") bits.push("waiting for a slot");
	else {
		if (row.turns > 0) bits.push(`${row.turns}t`);
		bits.push(`${row.elapsedSec}s`);
		const tok = tokens(row.tokens);
		if (tok) bits.push(tok);
		if (row.cost) bits.push(`$${row.cost.toFixed(3)}`);
	}
	if (row.failure) bits.push(`!${row.failure}`);
	const stats = theme.fg("dim", bits.join(" · "));
	const left = truncateToWidth(`${marker}${glyph} ${name}${label}`, width, "…");
	const room = width - visibleWidth(stats) - 1;
	if (room < 24) return truncateToWidth(`${left}  ${stats}`, width, "…");
	const head = visibleWidth(left) > room ? truncateToWidth(left, room, "…") : left;
	const pad = " ".repeat(Math.max(0, width - visibleWidth(head) - visibleWidth(stats)));
	return `${head}${pad}${stats}`;
}
