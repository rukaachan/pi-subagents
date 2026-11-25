/**
 * pi-subagents: one task, many legs.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { discoverSubagents } from "../../infra/files/index.ts";
import { showValue } from "../../domain/subagent/index.ts";
import type { SubagentConfig } from "../../domain/subagent/index.ts";
import { fanoutAdmission } from "../../domain/policy/index.ts";
import { codemodeContentionNote, codemodeLegs } from "../../domain/task/index.ts";
import { effectiveCodemodeWorkers } from "../../infra/host/index.ts";
import { withTemps } from "../../domain/run/index.ts";
import { useFooterUI } from "../../telemetry/live/index.ts";
import { MAX_LIVE_TASKS, newRunId } from "../../domain/task/index.ts";
import { type TaskStore } from "../../domain/task/index.ts";
import { applyRunOverrides, type RunOverrides } from "../../domain/run/index.ts";
import { readGlobalConfig, withGlobalConfig } from "../session/index.ts";
import { launchBackground } from "../run/index.ts";
import { unknownSubagentResult } from "./chain-task.ts";

export function parallelNamesFrom(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		if (typeof item === "string") {
			const name = item.trim();
			if (name) out.push(name);
			continue;
		}
		if (item && typeof item === "object") {
			const raw = (item as Record<string, unknown>).subagent_type;
			const name = (
				typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : showValue(raw)
			).trim();
			if (name) out.push(name);
		}
	}
	return out;
}

export async function runParallelTask(
	store: TaskStore,
	names: string[],
	params: {
		description?: string;
		prompt?: string;
		parallel?: unknown;
		model?: string;
		complexity?: string;
	},
	ctx: ExtensionContext,
	overrides: RunOverrides,
) {
	const { subagents, errors } = withTemps(discoverSubagents(ctx.cwd));
	const firstMissing = names.find((n) => !subagents.some((s) => s.name === n));
	if (firstMissing !== undefined) {
		return unknownSubagentResult(firstMissing, subagents, errors);
	}
	const global = readGlobalConfig(ctx.cwd, undefined, {
		trusted: ctx.isProjectTrusted?.() === true,
	});
	const cap = global.liveCap ?? MAX_LIVE_TASKS;
	const admission = fanoutAdmission(names.length, cap);
	if (!admission.ok) {
		return {
			content: [{ type: "text" as const, text: admission.reason }],
			details: { legs: names.length, live_cap: cap },
			isError: true,
		};
	}
	const legs = names.map((n) => {
		const base = subagents.find((s) => s.name === n) as SubagentConfig;
		return applyRunOverrides(withGlobalConfig(base, global), overrides);
	});
	if (!store.canStart(cap)) {
		return {
			content: [
				{
					type: "text" as const,
					text: `Too many live tasks (max ${cap}). Poll or wait for one to finish first.`,
				},
			],
			details: { live_cap: cap },
			isError: true,
		};
	}
	const shared = params.prompt ?? "";
	const items = Array.isArray(params.parallel) ? params.parallel : [];
	const perLeg: string[] = names.map((n) => {
		const idx = names.indexOf(n);
		const item = items[idx];
		if (item && typeof item === "object") {
			const p = (item as Record<string, unknown>).prompt;
			return typeof p === "string" ? p : shared;
		}
		return shared;
	});
	const label = params.description ?? shared.slice(0, 60) ?? names.join(" + ");
	useFooterUI(ctx.ui);
	const ids: string[] = [];
	const notStarted: string[] = [];
	const runId = newRunId("parallel");
	for (let i = 0; i < legs.length; i++) {
		const leg = legs[i];
		if (!leg) continue;
		const prompt = perLeg[i] ?? "";
		if (!store.canStart(cap)) {
			// Admission guarantees room; a full board here means a
			// concurrent launch took the last slot. Stop visibly and
			// name the legs that did not start; never fake an id.
			notStarted.push(...legs.slice(i).map((r) => r.name));
			break;
		}
		const id = await launchBackground(store, leg, label, prompt, ctx.cwd, ctx, {
			kind: "parallel",
			runId,
		});
		ids.push(id);
	}
	const lines = legs
		.slice(0, ids.length)
		.map((leg, i) => `${i + 1}. ${leg.name} — ${ids[i] ?? ""}`);
	// Codemode workers are a host-wide pool: two per process, shared by every session in it.
	const coders = codemodeLegs(legs.slice(0, ids.length));
	const contention = codemodeContentionNote(coders, effectiveCodemodeWorkers());
	const stopped =
		notStarted.length > 0
			? `\nNot started (live cap): ${notStarted.join(", ")} — launch them after the running legs finish.`
			: "";
	return {
		content: [
			{
				type: "text" as const,
				text: `Started ${ids.length} parallel legs (${names.join(" + ")}). Poll each with TaskOutput:\n${lines.join("\n")}${stopped}${contention}`,
			},
		],
		details: {
			parallel: names,
			task_ids: ids,
			status: "running",
			fanout_of: label,
			run_id: runId,
		},
	};
}
