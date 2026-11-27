/**
 * pi-subagents: the Agent team tab, one card per task.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentTeamTaskView } from "../../../domain/agent-team/index.ts";
import {
	cardLines,
	fitHint,
	screenHeader,
	stackLines,
	tabsLine,
	type StackItem,
	type Tone,
} from "../design/index.ts";
import { shortText } from "../text/index.ts";

export interface AgentTeamRow {
	view: AgentTeamTaskView;
	live: boolean;
}

export interface AgentTeamRoundInfo {
	id: number;
	tokens: number;
	ms: number;
	spent: number;
	elapsedMs: number;
}

export interface AgentTeamScreenOptions {
	width: number;
	height: number;
	cursor: number;
	theme: Pick<Theme, "fg" | "bold">;
	enabled: boolean;
	facts?: number;
	rounds?: readonly AgentTeamRoundInfo[];
}

export interface AgentTeamBody {
	width: number;
	height: number;
	cursor: number;
	theme: Pick<Theme, "fg" | "bold">;
	rounds?: readonly AgentTeamRoundInfo[];
}

const RANK: Record<string, number> = {
	in_progress: 0,
	in_review: 1,
	pending: 2,
	completed: 3,
	deleted: 4,
};

export function buildAgentTeamRows(
	views: readonly AgentTeamTaskView[],
	isLive: (owner: string) => boolean,
): AgentTeamRow[] {
	return views
		.map((view) => ({
			view,
			live: view.task.owner ? isLive(view.task.owner) : false,
		}))
		.toSorted((a, b) => (RANK[a.view.task.status] ?? 9) - (RANK[b.view.task.status] ?? 9));
}

export function agentTeamHeight(rows: readonly AgentTeamRow[]): number {
	if (rows.length === 0) return 9;
	const sections = new Set(rows.map((row) => sectionOf(row.view.task.status))).size;
	return 4 + sections + 5 * rows.length;
}

function sectionOf(status: string): string {
	if (status === "in_progress") return "IN PROGRESS";
	if (status === "in_review") return "IN REVIEW";
	if (status === "completed") return "DONE";
	if (status === "deleted") return "DELETED";
	return "OPEN";
}

function scopeText(view: AgentTeamTaskView): string {
	return view.task.writeScopes.length > 0 ? view.task.writeScopes.join(",") : "no scopes";
}

function flags(row: AgentTeamRow): string {
	const task = row.view.task;
	const last = task.attempts?.at(-1);
	const parts = [
		task.owner ?? "unowned",
		task.round ? "r" + task.round : "",
		row.view.ready ? "ready" : "",
		row.view.blockedByOpen.length ? "blocked " + row.view.blockedByOpen.join(",") : "",
		row.live ? "live" : "",
		task.runId ? "run " + task.runId : "",
		task.crossVerdict ? "cross " + task.crossVerdict : "",
		last ? "last " + last.outcome : "",
		scopeText(row.view),
	];
	return parts.filter(Boolean).join(" · ");
}

function detailOf(
	row: AgentTeamRow,
	rounds?: readonly AgentTeamRoundInfo[],
): { text: string; tone: Tone } | undefined {
	const task = row.view.task;
	const attempts = task.attempts?.slice(-2) ?? [];
	if (attempts.length > 0) {
		const text = attempts
			.map((attempt) => {
				const who = attempt.owner ? " · " + attempt.owner : "";
				const error = attempt.error ? ": " + attempt.error : "";
				return attempt.outcome + error + who;
			})
			.join("   ");
		return {
			text: shortText(text, 96),
			tone: attempts.at(-1)?.outcome === "passed" ? "success" : "error",
		};
	}
	if (task.crossVerify) {
		const who = task.crossVerifiedBy ? " by " + task.crossVerifiedBy : "";
		const state = task.crossVerdict ?? (task.verdict === "pass" ? "pending" : "waiting");
		return {
			text: "cross: " + state + who,
			tone:
				task.crossVerdict === "fail" ? "error" : task.crossVerdict === "pass" ? "success" : "muted",
		};
	}
	if (task.result) return { text: "result: " + shortText(task.result, 96), tone: "success" };
	if (task.verdict) {
		const who = task.verifiedBy ? " by " + task.verifiedBy : "";
		return {
			text: "verdict: " + task.verdict + who,
			tone: task.verdict === "pass" ? "success" : "error",
		};
	}
	const round = task.round ? rounds?.find((entry) => entry.id === task.round) : undefined;
	if (round) {
		return {
			text:
				"round " +
				round.id +
				" · " +
				round.spent +
				"/" +
				round.tokens +
				" tokens · " +
				Math.round(round.elapsedMs / 60_000) +
				"/" +
				Math.round(round.ms / 60_000) +
				" min",
			tone: "muted",
		};
	}
	if (task.status === "completed" && !task.runId) return { text: "no run linked", tone: "dim" };
	if (task.description) return { text: shortText(task.description, 96), tone: "muted" };
	return undefined;
}

function teamItems(
	rows: readonly AgentTeamRow[],
	width: number,
	theme: AgentTeamBody["theme"],
	cursor: number,
	rounds?: readonly AgentTeamRoundInfo[],
): StackItem[] {
	return rows.map((row, index) => {
		const detail = index === cursor ? detailOf(row, rounds) : undefined;
		return {
			section: sectionOf(row.view.task.status),
			lines: cardLines({
				width,
				theme,
				selected: index === cursor,
				status: row.view.task.status,
				title: row.view.task.id + "  " + row.view.task.subject,
				meta: "rev " + row.view.task.revision,
				subtitle: flags(row),
				...(detail ? { detail: detail.text, detailTone: detail.tone } : {}),
			}),
		};
	});
}

function emptyCard(width: number, theme: AgentTeamBody["theme"]): string[] {
	return cardLines({
		width,
		theme,
		status: "pending",
		tone: "muted",
		title: "No team tasks",
		subtitle: "Press n to add one.",
		detail: "s starts the team.",
	});
}

export function renderAgentTeamBody(rows: readonly AgentTeamRow[], opts: AgentTeamBody): string[] {
	const height = Math.max(1, opts.height);
	const cursor = rows.length === 0 ? 0 : Math.max(0, Math.min(opts.cursor, rows.length - 1));
	const out =
		rows.length === 0
			? emptyCard(opts.width, opts.theme)
			: stackLines(
					teamItems(rows, opts.width, opts.theme, cursor, opts.rounds),
					cursor,
					height,
					opts.theme,
				);
	while (out.length < height) out.push("");
	return out.slice(0, height);
}

export function agentTeamSummary(
	rows: readonly AgentTeamRow[],
	enabled: boolean,
	facts?: number,
): string {
	const open = rows.filter((row) => row.view.task.status === "pending").length;
	const active = rows.filter((row) => row.view.task.status === "in_progress").length;
	const review = rows.filter((row) => row.view.task.status === "in_review").length;
	const done = rows.filter((row) => row.view.task.status === "completed").length;
	const parts: string[] = [];
	if (active > 0) parts.push(active + " active");
	if (open > 0) parts.push(open + " open");
	if (review > 0) parts.push(review + " review");
	if (done > 0) parts.push(done + " done");
	if (parts.length === 0) parts.push("no tasks");
	if (facts && facts > 0) parts.push(facts + " facts");
	parts.push(enabled ? "on" : "off");
	return parts.join(" · ");
}

export function agentTeamHint(rows: readonly AgentTeamRow[], cursor: number): string {
	const status = rows[cursor]?.view.task.status;
	const parts = ["↑↓ move"];
	if (status) parts.push("enter detail");
	if (status === "pending") parts.push("c claim", "a assign");
	if (status === "in_progress") parts.push("x done", "r release");
	if (status === "in_review") parts.push("v verify");
	parts.push("? help", "n new");
	if (!status || status === "pending" || status === "completed") parts.push("s start");
	if (rows[cursor]?.view.task.runId) parts.push("o open run");
	if (status && status !== "deleted") parts.push("e edit");
	return parts.join("  ");
}

export function renderAgentTeamScreen(
	rows: readonly AgentTeamRow[],
	opts: AgentTeamScreenOptions,
): string[] {
	const { width, height, theme } = opts;
	const cursor = rows.length === 0 ? 0 : Math.max(0, Math.min(opts.cursor, rows.length - 1));
	const body = renderAgentTeamBody(rows, {
		width,
		height: Math.max(1, height - 4),
		cursor,
		theme,
		...(opts.rounds ? { rounds: opts.rounds } : {}),
	});
	const out = [
		screenHeader("Agent team", agentTeamSummary(rows, opts.enabled, opts.facts), width, theme),
		tabsLine(["RUNS", "AGENT TEAM"], 1, width, theme),
		"",
		...body,
		fitHint(agentTeamHint(rows, cursor), width, theme),
	];
	return out.slice(0, Math.max(1, height)).map((line) => truncateToWidth(line, width, ""));
}
