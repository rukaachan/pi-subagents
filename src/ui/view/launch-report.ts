/**
 * pi-subagents: delegate, finish, and team run reports.
 */

import type { LaunchLeg, LaunchRun } from "../../app/launch.ts";
import type { TaskRecord } from "../../app/task-record.ts";
import type { ReportQuery } from "../../domain/launch.ts";
import { footerProgress } from "../../telemetry/progress.ts";
import { shortKey, shortText, taskStatusIcon, usageLine } from "./format.ts";

const FULL_CHARS = 1500;
const MAX_ROWS = 200;

const LEG_ICONS: Record<LaunchLeg["status"], string> = {
	queued: "·",
	running: "…",
	done: "✓",
	error: "✗",
	stopped: "⊘",
};

function clip(text: string, max: number): string {
	const body = text.trim();
	return body.length <= max ? body : `${body.slice(0, max - 1)}…`;
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function elapsed(leg: LaunchLeg): string {
	if (leg.startedAt === undefined) return "";
	const end = leg.endedAt ?? (leg.status === "running" ? Date.now() : leg.startedAt);
	return `${Math.max(0, Math.round((end - leg.startedAt) / 1000))}s`;
}

function legTail(leg: LaunchLeg): string {
	const parts: string[] = [];
	const time = elapsed(leg);
	if (time) parts.push(time);
	if (leg.usage) parts.push(usageLine(leg.usage, leg.model));
	else if (leg.status === "running") {
		const snap = leg.taskId ? footerProgress.snapshot(leg.taskId) : undefined;
		if (snap) parts.push(`${snap.turns}t`);
	}
	return parts.join(" · ");
}

export function renderLegLine(leg: LaunchLeg): string {
	const id = leg.taskId ? shortKey(leg.taskId) : "—";
	const fam = leg.failure ? ` · [${leg.failure}]` : "";
	const head = `${LEG_ICONS[leg.status]} ${leg.name} · ${id} · ${leg.status.toUpperCase()}${fam}`;
	if (leg.status === "queued") return `${head} · waiting`;
	const tail = legTail(leg);
	const error = leg.status === "error" && leg.error ? ` — ${clip(oneLine(leg.error), 160)}` : "";
	return `${head}${tail ? ` · ${tail}` : ""}${error}`;
}

export function renderLegFull(leg: LaunchLeg): string {
	const head = renderLegLine(leg);
	if (leg.status !== "done" || !leg.report) return head;
	const notes = leg.notes && leg.notes.length > 0 ? `\n[notes: ${leg.notes.join(" ")}]` : "";
	return `${head}\n${clip(leg.report, FULL_CHARS)}${notes}`;
}

function countRun(run: LaunchRun): string {
	let done = 0;
	let failed = 0;
	let stopped = 0;
	let running = 0;
	let queued = 0;
	for (const leg of run.legs) {
		if (leg.status === "done") done += 1;
		else if (leg.status === "error") failed += 1;
		else if (leg.status === "stopped") stopped += 1;
		else if (leg.status === "running") running += 1;
		else queued += 1;
	}
	return [
		running > 0 ? `${running} running` : "",
		queued > 0 ? `${queued} queued` : "",
		`${done} done`,
		failed > 0 ? `${failed} failed` : "",
		stopped > 0 ? `${stopped} stopped` : "",
	]
		.filter(Boolean)
		.join(" · ");
}

const RUN_NAME: Record<LaunchRun["kind"], string> = {
	delegate: "Delegate",
	finish: "Finish",
	team: "Team start",
};

export function renderRunTitle(run: LaunchRun): string {
	return `${RUN_NAME[run.kind]} · ${run.label || "(no label)"} · ${run.legs.length} legs · ${countRun(run)}`;
}

function findLeg(run: LaunchRun, target: string): LaunchLeg | undefined {
	const want = target.toLowerCase();
	return run.legs.find((leg) => {
		if (leg.name.toLowerCase() === want) return true;
		if (!leg.taskId) return false;
		const id = leg.taskId.toLowerCase();
		return id === want || shortKey(leg.taskId).toLowerCase() === want || id.endsWith(want);
	});
}

function capRows(rows: string[]): string[] {
	if (rows.length <= MAX_ROWS) return rows;
	return [...rows.slice(0, MAX_ROWS), `… and ${rows.length - MAX_ROWS} more`];
}

export function renderRunReport(run: LaunchRun, query: ReportQuery): string {
	const title = renderRunTitle(run);
	if (query.mode === "full") {
		const leg = findLeg(run, query.target ?? "");
		if (!leg) {
			return `No leg "${query.target}" in this run.\nLegs: ${run.legs.map((l) => l.name).join(", ")}`;
		}
		return `${title}\n\n${renderLegFull(leg)}`;
	}
	const live = query.mode === "status";
	const legs = run.legs.filter(
		(leg) => !live || leg.status === "running" || leg.status === "queued",
	);
	if (legs.length === 0) {
		const hint =
			run.kind === "team"
				? "Use /subagents team for the board."
				: `Use /${run.kind} reports for the last result.`;
		return `${title}\nNothing live. ${hint}`;
	}
	return `${title}\n\n${capRows(legs.map(renderLegLine)).join("\n")}`;
}

function renderRecordLine(rec: TaskRecord): string {
	const fam = rec.failure ? ` · [${rec.failure}]` : "";
	const desc = rec.description ? ` · ${shortText(rec.description, 48)}` : "";
	const head = `${taskStatusIcon(rec.status)} ${rec.subagentName} · ${rec.status.toUpperCase()}${fam}${desc}`;
	const key = ` · ${shortKey(rec.taskId)}`;
	if (rec.status === "running") {
		const snap = footerProgress.snapshot(rec.taskId);
		return `${head}${snap ? ` · ${snap.turns}t · ${snap.elapsedSec}s` : ""}${key}`;
	}
	const use = rec.result ? usageLine(rec.result.usage, rec.result.model) : "";
	const tail = use ? ` · ${use}` : "";
	if (rec.status === "error") {
		return `${head}${tail}${key} — ${clip(oneLine(rec.error ?? "unknown error"), 160)}`;
	}
	return `${head}${tail}${key}`;
}

function renderRecordFull(rec: TaskRecord): string {
	const head = renderRecordLine(rec);
	if (rec.status !== "done" || !rec.result) return head;
	const notes = rec.result.notes.length > 0 ? `\n[notes: ${rec.result.notes.join(" ")}]` : "";
	return `${head}\n${clip(rec.result.text, FULL_CHARS)}${notes}`;
}

function findRecord(records: TaskRecord[], target: string): TaskRecord | undefined {
	const want = target.toLowerCase();
	const byId = records.find((rec) => {
		const id = rec.taskId.toLowerCase();
		return id === want || shortKey(rec.taskId).toLowerCase() === want || id.endsWith(want);
	});
	if (byId) return byId;
	const named = records.filter((rec) => rec.subagentName.toLowerCase() === want);
	return named.find((rec) => rec.status === "done") ?? named[0];
}

function countRecords(records: TaskRecord[]): string {
	let done = 0;
	let failed = 0;
	for (const rec of records) {
		if (rec.status === "done") done += 1;
		else if (rec.status === "error") failed += 1;
	}
	const running = records.length - done - failed;
	return [
		running > 0 ? `${running} running` : "",
		`${done} done`,
		failed > 0 ? `${failed} failed` : "",
	]
		.filter(Boolean)
		.join(" · ");
}

export function renderRecordsReport(
	records: TaskRecord[],
	command: string,
	query: ReportQuery,
): string {
	if (records.length === 0) return `No runs yet. Start one with /${command} <prompt>.`;
	const title = `Parallel runs · ${records.length} legs · ${countRecords(records)}`;
	const note = `No ${command} this session: showing the latest parallel runs.`;
	if (query.mode === "full") {
		const rec = findRecord(records, query.target ?? "");
		if (!rec) {
			return `No leg "${query.target}" in the latest runs.\nLegs: ${records.map((r) => r.subagentName).join(", ")}`;
		}
		return `${title}\n${note}\n\n${renderRecordFull(rec)}`;
	}
	const live = query.mode === "status";
	const rows = records.filter((rec) => !live || rec.status === "running");
	if (rows.length === 0) return `${title}\n${note}\nNothing live.`;
	return `${title}\n${note}\n\n${capRows(rows.map(renderRecordLine)).join("\n")}`;
}
