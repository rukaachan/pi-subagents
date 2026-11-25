/**
 * pi-subagents: pick the smallest matched roster and start a finish run.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { discoverSubagents } from "../infra/subagent-files.ts";
import { withTemps } from "../domain/run/index.ts";
import { pickRoster, type RosterPick } from "../domain/subagent/index.ts";
import { parseLaunchArgs, unknownLegs } from "../domain/policy/index.ts";
import { startLaunch, type LaunchRun } from "./launch.ts";
import { readGlobalConfig } from "./global-config.ts";
import { MAX_LIVE_TASKS } from "../domain/task/index.ts";
import type { TaskStore } from "../domain/task/index.ts";

const MAX_LEGS = 4;

export interface FinishStart {
	run: LaunchRun;
	started: number;
	queued: number;
	picks: RosterPick[];
	dropped: string[];
}

export type FinishResult =
	| { ok: true; start: FinishStart }
	| { ok: false; error: string; usage?: boolean };

function capOf(ctx: ExtensionCommandContext): number {
	const global = readGlobalConfig(ctx.cwd, undefined, {
		trusted: ctx.isProjectTrusted?.() === true,
	});
	return global.liveCap ?? MAX_LIVE_TASKS;
}

export function startFinish(
	store: TaskStore,
	args: string,
	ctx: ExtensionCommandContext,
): FinishResult {
	const parsed = parseLaunchArgs(args);
	if (!parsed.ok) {
		return {
			ok: false,
			usage: true,
			error: "Usage: /subagents finish <prompt>, or /subagents finish @a,@b <prompt>",
		};
	}
	const disk = withTemps(discoverSubagents(ctx.cwd));
	const subs = disk.subagents;
	if (subs.length === 0) {
		return { ok: false, error: `No subagents found. Add .md files to ${disk.userSubagentsDir}.` };
	}
	const limit = Math.max(1, Math.min(MAX_LEGS, capOf(ctx)));
	const available = subs.map((sub) => sub.name);
	let picks: RosterPick[] = [];
	let names: string[];
	let dropped: string[] = [];
	if (parsed.request.roster) {
		const missing = unknownLegs(parsed.request.roster, available);
		if (missing.length > 0) {
			return {
				ok: false,
				error: `Unknown subagent${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.\nRoster: ${available.join(", ")}`,
			};
		}
		names = parsed.request.roster.slice(0, limit);
		dropped = parsed.request.roster.slice(limit);
	} else {
		picks = pickRoster(parsed.request.prompt, subs, limit);
		names = picks.map((pick) => pick.name);
	}
	if (names.length === 0) {
		return { ok: false, error: `No subagent matched. Name one: ${available.join(", ")}` };
	}
	const started = startLaunch(store, "finish", names, parsed.request.prompt, ctx);
	if (!started.ok) return { ok: false, error: started.error };
	return {
		ok: true,
		start: {
			run: started.run,
			started: started.started,
			queued: started.queued,
			picks,
			dropped,
		},
	};
}
