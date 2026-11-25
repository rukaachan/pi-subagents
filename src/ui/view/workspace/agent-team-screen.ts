/**
 * pi-subagents: the Agent team tab of mission control.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentTeamTaskView } from "../../../domain/agent-team/index.ts";
import { shortText } from "../text/index.ts";
import { hintFrame } from "../text/index.ts";

export interface AgentTeamRow {
	view: AgentTeamTaskView;
	live: boolean;
}

export interface AgentTeamScreenOptions {
	width: number;
	height: number;
	cursor: number;
	theme: Pick<Theme, "fg" | "bold">;
	enabled: boolean;
}

const GLYPH = {
	pending: "○",
	in_progress: "…",
	in_review: "?",
	completed: "✓",
	deleted: "·",
} as const;
const COLOR = {
	pending: "warning",
	in_progress: "accent",
	in_review: "warning",
	completed: "success",
	deleted: "dim",
} as const;

export function buildAgentTeamRows(
	views: readonly AgentTeamTaskView[],
	isLive: (owner: string) => boolean,
): AgentTeamRow[] {
	return views.map((view) => ({
		view,
		live: view.task.owner ? isLive(view.task.owner) : false,
	}));
}

export function agentTeamHeight(rows: readonly AgentTeamRow[]): number {
	return Math.max(9, rows.length + 8);
}

function scopeText(view: AgentTeamTaskView): string {
	return view.task.writeScopes.length > 0 ? view.task.writeScopes.join(",") : "no scopes";
}

export function agentTeamRowLine(
	row: AgentTeamRow,
	selected: boolean,
	width: number,
	theme: Pick<Theme, "fg">,
): string {
	const task = row.view.task;
	const marker = selected ? theme.fg("accent", "› ") : "  ";
	const glyph = theme.fg(COLOR[task.status], GLYPH[task.status]);
	const subject = shortText(task.subject, 28);
	const left = `${marker}${glyph} ${task.id} ${subject}`;
	const owner = task.owner ?? "unowned";
	const flags = [
		owner,
		`rev ${task.revision}`,
		row.view.ready ? "ready" : "",
		row.view.blockedByOpen.length ? `blocked ${row.view.blockedByOpen.join(",")}` : "",
		row.live ? "live" : "",
	]
		.filter(Boolean)
		.join(" · ");
	const stats = theme.fg("dim", flags);
	const room = Math.max(10, width - visibleWidth(stats) - 1);
	const head = truncateToWidth(selected ? theme.fg("accent", left) : left, room, "…");
	const pad = " ".repeat(Math.max(0, width - visibleWidth(head) - visibleWidth(stats)));
	return truncateToWidth(`${head}${pad}${stats}`, width, "…");
}

export function agentTeamDetailLines(
	row: AgentTeamRow | undefined,
	width: number,
	theme: Pick<Theme, "fg" | "bold">,
): string[] {
	if (!row) return [theme.fg("dim", "No team task selected")];
	const task = row.view.task;
	const owner = task.owner ?? "unowned";
	const lines = [
		theme.fg("muted", "SELECTED"),
		theme.bold(`${task.id} · ${shortText(task.subject, 40)}`),
		theme.fg(COLOR[task.status], task.status.toUpperCase()),
		theme.fg("dim", `rev ${task.revision} · ${owner}${row.live ? " · live" : ""}`),
		theme.fg("dim", task.runId ? `run ${task.runId}` : "no run linked"),
	];
	if (task.acceptance)
		lines.push(theme.fg("warning", `acceptance: ${shortText(task.acceptance, 100)}`));
	if (task.verdict) {
		const who = task.verifiedBy ? ` by ${task.verifiedBy}` : "";
		lines.push(
			theme.fg(task.verdict === "pass" ? "success" : "error", `verdict: ${task.verdict}${who}`),
		);
	}
	if (task.verifyRunId) lines.push(theme.fg("dim", `verifier run ${task.verifyRunId}`));
	if (task.result) lines.push(theme.fg("text", `result: ${shortText(task.result, 120)}`));
	lines.push(theme.fg("dim", `scopes: ${scopeText(row.view)}`));
	if (row.view.blockedByOpen.length > 0) {
		lines.push(theme.fg("warning", `blocked by ${row.view.blockedByOpen.join(", ")}`));
	}
	if (task.lastOwner || task.lastError) {
		lines.push(theme.fg("error", `last ${task.lastOwner ?? "run"}: ${task.lastError ?? ""}`));
	}
	lines.push(theme.fg("muted", shortText(task.description || "(no description)", 120)));
	return lines.map((line) => truncateToWidth(line, width, "…"));
}

function agentTeamHint(rows: readonly AgentTeamRow[], cursor: number): string {
	const status = rows[cursor]?.view.task.status;
	const parts = ["↑↓"];
	if (status) parts.push("enter");
	if (status === "pending") parts.push("c claim");
	if (status === "in_progress") parts.push("x done", "r release");
	if (status === "pending" || status === "in_progress") parts.push("a assign");
	if (status === "in_review") parts.push("v verify");
	if (status && status !== "deleted") parts.push("i advice", "e edit", "d delete");
	if (rows[cursor]?.view.task.runId) parts.push("o open run");
	parts.push("n new", "s start", "tab", "esc");
	return parts.join(" · ");
}

export function renderAgentTeamScreen(
	rows: readonly AgentTeamRow[],
	opts: AgentTeamScreenOptions,
): string[] {
	const { width, height, theme } = opts;
	const bodyRows = Math.max(1, height - 5);
	const cursor = rows.length === 0 ? 0 : Math.max(0, Math.min(opts.cursor, rows.length - 1));
	const wide = width >= 96;
	const listWidth = wide ? Math.min(74, Math.max(56, Math.floor(width * 0.62))) : width;
	const detailWidth = width - listWidth - 3;
	const lines = rows.map((row, index) => agentTeamRowLine(row, index === cursor, listWidth, theme));
	let top = 0;
	if (lines.length > bodyRows) {
		top = Math.max(0, Math.min(cursor - Math.floor(bodyRows / 2), lines.length - bodyRows));
	}
	const shown = lines.slice(top, top + bodyRows);
	while (shown.length < bodyRows) shown.push("");
	const details = wide ? agentTeamDetailLines(rows[cursor], detailWidth, theme) : [];
	const body = shown.map((line, index) => {
		if (!wide) return line;
		const clipped = truncateToWidth(line, listWidth, "…");
		const pad = " ".repeat(Math.max(0, listWidth - visibleWidth(clipped)));
		const detail = truncateToWidth(details[index] ?? "", detailWidth, "…");
		return `${clipped}${pad}${theme.fg("borderMuted", " │ ")}${detail}`;
	});
	const open = rows.filter(
		(row) => row.view.task.status !== "completed" && row.view.task.status !== "in_review",
	).length;
	const review = rows.filter((row) => row.view.task.status === "in_review").length;
	const done = rows.filter((row) => row.view.task.status === "completed").length;
	const title = `${theme.bold("Mission control")}  ${theme.fg("muted", `${open} open · ${review} review · ${done} done · team ${opts.enabled ? "on" : "off"} (t)`)}`;
	const rule = theme.fg("borderMuted", "─".repeat(Math.max(1, width)));
	const hint = theme.fg("dim", agentTeamHint(rows, cursor));
	const box = hintFrame(hint, width, wide ? listWidth + 1 : undefined, theme);
	return [title, rule, ...body, ...box];
}
