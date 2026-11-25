/**
 * pi-subagents: the /delegate command.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { discoverSubagents } from "../infra/subagent-files.ts";
import { withTemps } from "../domain/run/index.ts";
import {
	findLaunchLeg,
	parseOpenQuery,
	parseReportQuery,
	parseLaunchArgs,
	rosterFor,
} from "../domain/policy/index.ts";
import { latestLaunch, startLaunch, syncLegFailures } from "../app/launch.ts";
import type { TaskStore } from "../domain/task/index.ts";
import { scopeTasks, type TaskScope } from "../app/task-scope.ts";
import { openSessionView } from "./view/session-view.ts";
import { renderRecordsReport, renderRunReport } from "./view/launch-report.ts";

const MAX_START_ROWS = 12;
const COMMAND = "delegate";

function rosterLine(cwd: string): string {
	try {
		const { subagents } = withTemps(discoverSubagents(cwd));
		if (subagents.length === 0) return "Roster: (none found)";
		return `Roster (${subagents.length}): ${subagents.map((s) => s.name).join(", ")}`;
	} catch {
		return "Roster: (discovery failed)";
	}
}

function usage(store: TaskStore, scope: TaskScope): string {
	const common = [
		`/${COMMAND} reports          compact status`,
		`/${COMMAND} report <name>    one leg's full report`,
		`/${COMMAND} open <name>      one leg's live session`,
		`/${COMMAND} status           live legs only`,
	];
	const live = scopeTasks(store.list(), scope).filter(
		(rec) => rec.status === "running" && rec.kind === "parallel",
	);
	const lines = [
		"Delegate · two subagents, one prompt",
		`/${COMMAND} <prompt>          explorer + worker`,
		`/${COMMAND} @a,@b <prompt>    a named pair`,
		...common,
		rosterLine(scope.cwd),
	];
	if (live.length > 0) lines.push("", `Live parallel legs: ${live.length}`);
	return lines.join("\n");
}

function reports(store: TaskStore, text: string, scope: TaskScope): string {
	const query = parseReportQuery(text);
	if (!query) return "";
	const run = latestLaunch("delegate");
	if (run) {
		syncLegFailures(run, (id) => store.get(id));
		return renderRunReport(run, query);
	}
	const records = scopeTasks(store.list(), scope)
		.filter((rec) => rec.kind === "parallel")
		.toReversed();
	return renderRecordsReport(records, COMMAND, query);
}

async function openLeg(
	store: TaskStore,
	target: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const run = latestLaunch("delegate");
	if (!run) {
		ctx.ui.notify(`No ${COMMAND} run in this session yet.`, "info");
		return;
	}
	if (!target) {
		const names = run.legs.map((leg) => leg.name).join(", ");
		ctx.ui.notify(`Usage: /${COMMAND} open <name|task-id>\nLegs: ${names}`, "info");
		return;
	}
	const found = findLaunchLeg(run.legs, target);
	if (!found.ok) {
		const matches = found.matches
			?.map((leg) => `${leg.name} (${leg.taskId ?? "queued"})`)
			.join(", ");
		ctx.ui.notify(matches ? `${found.error}\n${matches}` : found.error, "warning");
		return;
	}
	const leg = found.leg;
	if (!leg.taskId) {
		ctx.ui.notify(`${leg.name} is still queued; it has no session yet.`, "warning");
		return;
	}
	const rec = store.get(leg.taskId);
	if (!rec) {
		ctx.ui.notify(
			`${leg.name} is no longer in memory. Use /${COMMAND} report ${leg.name} for its text.`,
			"warning",
		);
		return;
	}
	if (rec.history.length === 0 && rec.status !== "running") {
		ctx.ui.notify(
			`No transcript saved for ${leg.name}. Use /${COMMAND} report ${leg.name}.`,
			"info",
		);
		return;
	}
	await openSessionView(ctx, rec);
}

function startedNotice(started: ReturnType<typeof startLaunch>): string {
	if (!started.ok) return started.error;
	const rows = started.run.legs;
	const lines = rows
		.slice(0, MAX_START_ROWS)
		.map((leg, i) => `${i + 1}. ${leg.name} — ${leg.taskId ?? "queued"}`);
	if (rows.length > MAX_START_ROWS) lines.push(`… and ${rows.length - MAX_START_ROWS} more`);
	const state = [`${started.started} started`, started.queued > 0 ? `${started.queued} queued` : ""]
		.filter(Boolean)
		.join(" · ");
	return `${state}\n${lines.join("\n")}\n\n/${COMMAND} reports for a summary.`;
}

export function registerDelegateCommand(pi: ExtensionAPI, store: TaskStore): void {
	pi.registerCommand(COMMAND, {
		description: "Run one prompt on explorer + worker, or a named pair",
		getArgumentCompletions: (prefix) => {
			const value = prefix.trim();
			const hits: string[] = [];
			if (value.toLowerCase().startsWith("open ")) {
				const head = value.slice(5).trim().toLowerCase();
				for (const leg of latestLaunch("delegate")?.legs ?? []) {
					if (leg.name.toLowerCase().startsWith(head)) hits.push(`open ${leg.name}`);
				}
				return hits.length > 0 ? hits.map((v) => ({ value: v, label: v })) : null;
			}
			if (!value.includes("@")) hits.push("reports", "report", "status", "open");
			try {
				const names = discoverSubagents(process.cwd()).subagents.map((s) => s.name);
				if (value.startsWith("@")) {
					const parts = value.slice(1).split(",");
					const head = parts.slice(0, -1);
					const last = parts.at(-1) ?? "";
					for (const name of names) {
						if (name.startsWith(last)) hits.push(`@${[...head, name].join(",")}`);
					}
				} else {
					for (const name of names) hits.push(`@${name}`);
				}
			} catch {
				/* completion must not throw */
			}
			return hits.length > 0 ? hits.map((v) => ({ value: v, label: v })) : null;
		},
		handler: async (args, ctx) => {
			const raw = args.trim();
			const open = parseOpenQuery(raw);
			if (open !== null) {
				await openLeg(store, open, ctx);
				return;
			}
			const scope = { cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId() };
			const report = reports(store, raw, scope);
			if (report) {
				ctx.ui.notify(report, "info");
				return;
			}
			if (!raw) {
				ctx.ui.notify(usage(store, scope), "info");
				return;
			}
			const parsed = parseLaunchArgs(raw);
			if (!parsed.ok) {
				ctx.ui.notify(parsed.error, "warning");
				return;
			}
			const { subagents } = withTemps(discoverSubagents(ctx.cwd));
			const names = rosterFor(
				"delegate",
				parsed.request.roster,
				subagents.map((sub) => sub.name),
			);
			const started = startLaunch(store, "delegate", names, parsed.request.prompt, ctx);
			ctx.ui.notify(startedNotice(started), started.ok ? "info" : "error");
		},
	});
}
