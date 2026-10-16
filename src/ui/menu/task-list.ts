/**
 * pi-subagents: the task list and one task's detail.
 */

import { copyToClipboard, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ledger } from "../../app/ledger.ts";
import { pickFromList } from "../picker.ts";
import { inModal } from "../../app/modal-depth.ts";
import { taskRowItems } from "./items.ts";
import { chainStrip, spawnSummary } from "../view/rows.ts";
import { taskStatusIcon } from "../view/format.ts";
import { shortKey } from "../view/format.ts";
import { taskDetail } from "../view/detail.ts";
import { footerProgress } from "../../telemetry/progress.ts";
import { findJournalRun } from "../../telemetry/journal.ts";
import { RECENT_LIMIT } from "../../domain/activity-step.ts";
import { activityLine, activityRows } from "../../telemetry/activity.ts";
import { ROUTE } from "./constants.ts";
import type { TaskRecord } from "../../app/task-record.ts";
import { TaskStore } from "../../app/task-store.ts";
import type { ActivityStep } from "../../domain/activity-step.ts";
import type { LiveRunInfo } from "../view/detail.ts";

async function copyId(ctx: ExtensionCommandContext, id: string): Promise<void> {
	try {
		await copyToClipboard(id);
		ctx.ui.notify(`Copied ${id}.`, "info");
	} catch {
		ctx.ui.notify(id, "info");
	}
}

export function taskLive(t: TaskRecord): 0 | 1 {
	return t.status === "running" ? 0 : 1;
}

export function liveInfoFor(rec: TaskRecord): LiveRunInfo | undefined {
	if (rec.status !== "running") return undefined;
	if (rec.kind === "chain" && rec.steps && rec.steps.length > 0) {
		const live = rec.steps
			.map((_, idx) => footerProgress.snapshot(`${rec.taskId}-${idx}`))
			.filter((s) => s !== undefined);
		const running = rec.steps.findIndex((s) => s.status === "running");
		const step = running >= 0 ? rec.steps[running] : undefined;
		const snap = running >= 0 ? footerProgress.snapshot(`${rec.taskId}-${running}`) : undefined;
		return {
			turns: live.reduce((n, s) => n + (s?.turns ?? 0), 0),
			tool: snap?.tool,
			elapsedSec: step?.startedAt ? Math.round((Date.now() - step.startedAt) / 1000) : undefined,
			partial: snap?.partial,
		};
	}
	const snap = footerProgress.snapshot(rec.taskId);
	if (snap) {
		return {
			turns: snap.turns,
			tool: snap.tool,
			elapsedSec: snap.elapsedSec,
			partial: snap.partial,
		};
	}
	const jr = findJournalRun(rec.taskId);
	if (!jr) return undefined;
	return {
		status: jr.status,
		turns: jr.turns,
		tool: jr.tool,
		elapsedSec: Math.max(0, Math.round((Date.now() - jr.startedAt) / 1000)),
	};
}

export function sortTaskRows(tasks: TaskRecord[]): TaskRecord[] {
	return tasks.toSorted((a, b) => {
		if (taskLive(a) !== taskLive(b)) return taskLive(a) - taskLive(b);
		return b.createdAt - a.createdAt;
	});
}

function lastStep(key: string): ActivityStep | undefined {
	const live = footerProgress.recent(key);
	if (live.length > 0) return live.at(-1);
	return findJournalRun(key)?.recent?.at(-1);
}

export function recentSteps(rec: TaskRecord): string[] | undefined {
	const live: ActivityStep[] = footerProgress.recent(rec.taskId);
	if (live.length > 0) return activityRows(live);
	if (rec.kind === "parallel" && rec.legs) {
		const rows: string[] = [];
		for (const leg of rec.legs) {
			if (!leg.taskId || leg.status !== "running") continue;
			const step = lastStep(leg.taskId);
			if (step) rows.push(`${leg.subagentName}#${leg.idx + 1} · ${activityLine(step)}`);
			if (rows.length >= RECENT_LIMIT) break;
		}
		if (rows.length > 0) return rows;
	}
	const jr = findJournalRun(rec.taskId);
	return jr?.recent && jr.recent.length > 0 ? activityRows(jr.recent) : undefined;
}

export async function showTaskDetail(
	ctx: ExtensionCommandContext,
	store: TaskStore,
	rec: TaskRecord,
): Promise<void> {
	const isChain = rec.kind === "chain";
	const isParallelGroup = rec.kind === "parallel" && !!rec.legs && rec.legs.length > 1;
	ctx.ui.notify(taskDetail(rec, liveInfoFor(rec)), "info");
	if (isChain && rec.status !== "running") {
		ctx.ui.notify("Chains restart as a new Task with chain[] — steps cannot resume alone.", "info");
	}
	const acts =
		rec.status === "running" || isChain || isParallelGroup
			? ["Copy task_id", "← Back to runs"]
			: ["Resume with follow-up", "Copy task_id", "← Back to runs"];
	const who = isChain ? chainStrip(rec) : rec.subagentName;
	const next = await pickFromList(ctx, {
		title: `${taskStatusIcon(rec.status)} ${who} · ${shortKey(rec.taskId)}`,
		subtitle: "enter to choose · esc to go back",
		body: recentSteps(rec),
		items: acts.map((a) => ({ value: a, label: a })),
	});
	if (next === "Copy task_id") await copyId(ctx, rec.taskId);
	else if (next === "Resume with follow-up") {
		const follow = await inModal(() => ctx.ui.input(`Follow-up for ${rec.subagentName}`, ""));
		if (!follow) return;
		const { resumeTask } = await import("../../app/background.ts");
		const r = await resumeTask(store, rec.taskId, rec.subagentName, follow, ctx);
		if ("error" in r) ctx.ui.notify(r.error, "error");
		else ctx.ui.notify(`Resumed as ${r.taskId}.`, "info");
	}
}

export async function showTaskList(ctx: ExtensionCommandContext, store: TaskStore): Promise<void> {
	for (;;) {
		const tasks = sortTaskRows(store.list());
		if (tasks.length === 0) {
			ctx.ui.notify("No runs yet this session.", "info");
			return;
		}
		const pick = await pickFromList(ctx, {
			title: spawnSummary(ledger.bySubagent()),
			subtitle: "● fg ● alias ○ bg · live first",
			items: [...taskRowItems(tasks), { value: ROUTE.cancel, label: "← Back" }],
		});
		if (!pick || pick === ROUTE.cancel) return;
		const rec = tasks.find((t) => t.taskId === pick);
		if (!rec) {
			ctx.ui.notify("That run expired.", "warning");
			continue;
		}
		await showTaskDetail(ctx, store, rec);
	}
}
