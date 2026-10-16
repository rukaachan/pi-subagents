/**
 * pi-subagents: a chain as one task.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { suggestSubagentName } from "../domain/subagent/discovery.ts";
import type { SubagentConfig } from "../domain/subagent/config.ts";
import { useFooterUI } from "../telemetry/progress.ts";
import { MAX_LIVE_TASKS } from "./task-record.ts";
import { runChain } from "./chain.ts";
import { isRunStopped, stoppedToolText } from "../domain/run-stop.ts";
import { toUsage } from "../infra/host-usage.ts";
import type { ChainSpec } from "./chain.ts";
import { TaskStore } from "./task-store.ts";
import { readGlobalConfig, withGlobalConfig } from "./global-config.ts";
import type { GlobalConfig } from "./global-config.ts";
import { applyRunOverrides } from "../domain/tiers.ts";
import type { RunOverrides } from "../domain/tiers.ts";

export function unknownSubagentResult(
	name: string,
	subagents: { name: string }[],
	errors: string[],
) {
	const available = subagents.map((s) => s.name).join(", ") || "none";
	const names = subagents.map((s) => s.name);
	const hintName = suggestSubagentName(name, names);
	const didYou = hintName ? ` Did you mean "${hintName}"?` : "";
	const hint = errors.length > 0 ? `\nLoad notes: ${errors.join("; ")}` : "";
	return {
		content: [
			{
				type: "text" as const,
				text: `Unknown subagent "${name}".${didYou} Available: ${available}.${hint}`,
			},
		],
		details: { subagent_type: name, available: names },
		isError: true,
	};
}

export function chainConfigs(
	names: string[],
	subagents: SubagentConfig[],
	global: GlobalConfig,
	overrides: RunOverrides,
): SubagentConfig[] {
	return names.map((n) => {
		const found = subagents.find((s) => s.name === n) as SubagentConfig;
		return applyRunOverrides(withGlobalConfig(found, global), overrides);
	});
}

export async function runChainTask(
	store: TaskStore,
	names: string[],
	params: { description: string; prompt: string; run_in_background?: boolean },
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
	subagents: SubagentConfig[],
	overrides: RunOverrides = {},
) {
	const firstMissing = names.find((n) => !subagents.some((s) => s.name === n));
	if (firstMissing !== undefined) {
		return unknownSubagentResult(firstMissing, subagents, []);
	}
	if (!store.canStart()) {
		return {
			content: [
				{
					type: "text" as const,
					text: `Too many live tasks (max ${MAX_LIVE_TASKS}). Poll or wait for one to finish first.`,
				},
			],
			details: { live_cap: MAX_LIVE_TASKS },
			isError: true,
		};
	}
	const ordered = chainConfigs(names, subagents, readGlobalConfig(ctx.cwd), overrides);
	const spec: ChainSpec = { steps: names, prompt: params.prompt };
	useFooterUI(ctx.ui);
	const started = runChain(
		store,
		spec,
		ordered,
		ctx.cwd,
		ctx,
		params.description,
		"background",
		signal,
	);
	if ("error" in started) {
		return {
			content: [{ type: "text" as const, text: started.error }],
			details: { chain: names },
			isError: true,
		};
	}
	if (params.run_in_background === true) {
		// A background chain is nobody's await: a stop request rejects
		// `done`, and the row is already booked and gone.
		void started.done.catch(() => {});
		return {
			content: [
				{
					type: "text" as const,
					text: `Started chain ${started.taskId} (${names.join(" → ")}). Poll with TaskOutput.`,
				},
			],
			details: { task_id: started.taskId, chain: names, status: "running" },
		};
	}
	try {
		await started.done;
	} catch (err) {
		if (isRunStopped(err)) {
			return {
				content: [{ type: "text" as const, text: stoppedToolText(names.join(" → "), err.why) }],
				details: { chain: names, status: "stopped" },
				isError: true,
			};
		}
		throw err;
	}
	const rec = store.get(started.taskId);
	if (!rec || rec.status === "error") {
		const message = rec?.error ?? "chain failed";
		return {
			content: [{ type: "text" as const, text: `Chain failed: ${message}` }],
			details: { task_id: started.taskId, chain: names, error: message },
			isError: true,
		};
	}
	const result = rec.result;
	const head = rec.steps
		? rec.steps.map((s) => `${s.idx + 1}. ${s.subagentName} ✓`).join(" · ")
		: names.join(" → ");
	return {
		content: [{ type: "text" as const, text: `${head}\n\n${result?.text ?? "(no report)"}` }],
		details: {
			task_id: started.taskId,
			chain: names,
			status: "done",
			model: result?.model,
			usage: result?.usage,
		},
		usage: result ? toUsage(result.usage) : undefined,
	};
}
