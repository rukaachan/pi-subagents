/**
 * pi-subagents: delegate, finish, and team runs with a slot queue.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ChildDeps } from "../run/index.ts";
import { discoverSubagents } from "../../infra/files/index.ts";
import { withTemps } from "../../domain/run/index.ts";
import type { SubagentRunResult } from "../../domain/run/index.ts";
import type { FailureFamily, LaunchKind } from "../../domain/policy/index.ts";
import { unknownLegs } from "../../domain/policy/index.ts";
import { launchBackground } from "../run/index.ts";
import { readGlobalConfig, withGlobalConfig } from "../session/index.ts";
import { useFooterUI } from "../../telemetry/live/index.ts";
import type { TaskRecord, TaskStorePort } from "../../domain/task/index.ts";
import { MAX_LIVE_TASKS, newRunId } from "../../domain/task/index.ts";

export type LegStatus = "queued" | "running" | "done" | "error" | "stopped";

export interface LaunchLeg {
	name: string;
	status: LegStatus;
	taskId?: string;
	report?: string;
	notes?: string[];
	error?: string;
	startedAt?: number;
	endedAt?: number;
	model?: string;
	failure?: FailureFamily;
	usage?: SubagentRunResult["usage"];
}

export interface LaunchRun {
	kind: LaunchKind;
	label: string;
	runId: string;
	startedAt: number;
	legs: LaunchLeg[];
	/** The Pi session that started it; absent on runs built by tests. */
	sessionId?: string;
}

export type LaunchStart =
	| { ok: true; run: LaunchRun; started: number; queued: number }
	| { ok: false; error: string };

const latest: Record<LaunchKind, LaunchRun | null> = {
	delegate: null,
	finish: null,
	"agent-team": null,
};
const closers = new Set<() => void>();
const openRuns = new Set<LaunchRun>();

/** Legs still waiting for a free slot across the open schedulers. */
export function queuedLegCount(sessionId?: string): number {
	let count = 0;
	for (const run of openRuns) {
		if (sessionId !== undefined && run.sessionId !== sessionId) continue;
		for (const leg of run.legs) if (leg.status === "queued") count += 1;
	}
	return count;
}

export function latestLaunch(kind: LaunchKind): LaunchRun | null {
	return latest[kind];
}

/** Labels can arrive after the scheduler stops; refresh them before a report. */
export function syncLegFailures(
	run: LaunchRun,
	get: (taskId: string) => TaskRecord | undefined,
): void {
	for (const leg of run.legs) {
		if (!leg.taskId) continue;
		const rec = get(leg.taskId);
		if (rec?.failure) leg.failure = rec.failure;
	}
}

/** Stop every scheduler and mark its unfinished legs stopped. */
export function stopLaunchSchedulers(): void {
	for (const close of closers) close();
	closers.clear();
}

function settle(leg: LaunchLeg, rec: TaskRecord | undefined): void {
	if (!rec) {
		if (leg.status === "running") leg.status = "stopped";
		if (leg.status === "stopped") leg.endedAt = Date.now();
		return;
	}
	leg.failure = rec.failure;
	if (rec.status === "done") {
		leg.status = "done";
		leg.report = rec.result?.text ?? "";
		leg.notes = rec.result?.notes;
		leg.model = rec.result?.model;
		leg.usage = rec.result?.usage;
		leg.endedAt = Date.now();
		return;
	}
	if (rec.status === "error") {
		leg.status = "error";
		leg.error = rec.error;
		leg.endedAt = Date.now();
	}
}

export function startLaunch(
	store: TaskStorePort,
	kind: LaunchKind,
	names: string[],
	prompt: string,
	ctx: ExtensionContext,
	deps: ChildDeps,
	options: {
		promptFor?: (name: string, index: number) => string;
		/** Called when a leg gets its run id, including legs that waited in the queue. */
		onLeg?: (index: number, taskId: string) => void;
		/** The board task already created for this leg, if any. */
		agentTeamTaskIdFor?: (index: number) => string | undefined;
	} = {},
): LaunchStart {
	const disk = withTemps(discoverSubagents(ctx.cwd));
	const available = disk.subagents.map((sub) => sub.name);
	if (available.length === 0) {
		return { ok: false, error: `No subagents found. Add .md files to ${disk.userSubagentsDir}.` };
	}
	if (names.length === 0) return { ok: false, error: "Pick at least one subagent." };
	const missing = unknownLegs(names, available);
	if (missing.length > 0) {
		return {
			ok: false,
			error: `Unknown subagent${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.\nRoster: ${available.join(", ")}`,
		};
	}
	const label = prompt.replace(/\s+/g, " ").trim().slice(0, 60);
	const runId = newRunId("parallel");
	const run: LaunchRun = {
		kind,
		label,
		runId,
		startedAt: Date.now(),
		legs: names.map((name) => ({ name, status: "queued" })),
		...(ctx.sessionManager ? { sessionId: ctx.sessionManager.getSessionId() } : {}),
	};
	latest[kind] = run;
	openRuns.add(run);
	const global = readGlobalConfig(ctx.cwd, undefined, {
		trusted: ctx.isProjectTrusted?.() === true,
	});
	const cap = global.liveCap ?? MAX_LIVE_TASKS;
	// Every other task path points the progress tracker at the footer.
	// Without this the legs run invisibly: no live line, no turn counter.
	useFooterUI(ctx.ui);
	let next = 0;
	let closed = false;
	let pumping = false;
	let unsubscribe: (() => void) | null = null;

	const launchNext = (): void => {
		if (closed || pumping) return;
		pumping = true;
		try {
			while (next < run.legs.length && store.canStart(cap)) {
				const leg = run.legs[next];
				next += 1;
				if (!leg) break;
				const base = disk.subagents.find((sub) => sub.name === leg.name);
				if (!base) {
					leg.status = "error";
					leg.error = "Subagent disappeared before launch.";
					continue;
				}
				// Claim the slot before the row lands, so a queue count taken
				// inside store.add never sees the leg twice.
				const index = next - 1;
				const legPrompt = options.promptFor?.(leg.name, index) ?? prompt;
				leg.status = "running";
				leg.startedAt = Date.now();
				const teamTaskId = options.agentTeamTaskIdFor?.(index);
				try {
					leg.taskId = launchBackground(
						store,
						withGlobalConfig(base, global),
						label,
						legPrompt,
						ctx.cwd,
						ctx,
						deps,
						{
							kind: "parallel",
							runId,
							agentTeamOrigin: kind === "agent-team" ? "start" : kind,
							...(teamTaskId ? { agentTeamTaskId: teamTaskId } : {}),
						},
					);
					options.onLeg?.(index, leg.taskId);
				} catch (err) {
					leg.status = "error";
					leg.error = err instanceof Error ? err.message : String(err);
					leg.endedAt = Date.now();
				}
			}
		} finally {
			pumping = false;
		}
	};

	const close = (): void => {
		if (closed) return;
		closed = true;
		for (const leg of run.legs) {
			if (leg.status === "queued" || leg.status === "running") leg.status = "stopped";
			if (leg.startedAt !== undefined) leg.endedAt = leg.endedAt ?? Date.now();
		}
		unsubscribe?.();
		closers.delete(close);
		openRuns.delete(run);
	};

	const sync = (): void => {
		if (closed) return;
		for (const leg of run.legs) {
			if (!leg.taskId || leg.status === "done" || leg.status === "error") continue;
			if (leg.status === "stopped") continue;
			settle(leg, store.get(leg.taskId));
		}
		const waiting = run.legs.some((leg) => leg.status === "queued");
		const running = run.legs.some((leg) => leg.status === "running");
		if (!waiting && !running) {
			close();
			return;
		}
		launchNext();
	};

	unsubscribe = store.subscribe(sync);
	closers.add(close);
	launchNext();
	return {
		ok: true,
		run,
		started: run.legs.filter((leg) => leg.status !== "queued").length,
		queued: run.legs.filter((leg) => leg.status === "queued").length,
	};
}
