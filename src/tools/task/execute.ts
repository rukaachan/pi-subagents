/**
 * pi-subagents: running a Task call.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { discoverSubagents } from "../../infra/files/index.ts";
import { registerTemp, withTemps } from "../../domain/run/index.ts";
import { markKind } from "../../app/session/index.ts";
import { MAX_LIVE_TASKS, newRecord } from "../../domain/task/index.ts";
import { store } from "../../app/session/index.ts";
import { pickFromPrompt } from "../../domain/task/tool/index.ts";
import { launchBackground, resumeTask } from "../../app/run/index.ts";
import { runChainTask, unknownSubagentResult } from "../../app/chain/index.ts";
import { runParallelTask } from "../../app/chain/index.ts";
import { runSubagent } from "../../app/run/index.ts";
import { useFooterUI } from "../../telemetry/live/index.ts";
import { newRunKey } from "../../telemetry/live/index.ts";
import { applyRunOverrides, overrideNote } from "../../domain/task/tool/index.ts";
import { readGlobalConfig, withGlobalConfig } from "../../app/session/index.ts";
import type { TaskParams } from "../../domain/task/tool/index.ts";
import type { ToolResult } from "../../domain/task/tool/index.ts";
import { toUsage } from "../../infra/host/index.ts";
import { planTask } from "../../domain/task/tool/index.ts";
import { markStopped } from "../../app/stop/index.ts";
import { isRunStopped, stoppedToolText } from "../../domain/task/index.ts";
import { capDelivery } from "../../domain/run/index.ts";

function callerTools(ctx: ExtensionContext): string[] | undefined {
	const tools = (ctx as unknown as { tools?: readonly { name: string }[] }).tools;
	return tools?.map((t) => t.name);
}

export async function executeTask(
	_toolCallId: string,
	params: TaskParams,
	signal: AbortSignal | undefined,
	_onUpdate: unknown,
	ctx: ExtensionContext,
): Promise<ToolResult> {
	const planned = planTask(params);
	if (!planned.ok) return planned.error;
	const { overrides, chainNames, parallelNames, returnFields } = planned.plan;
	if (parallelNames.length > 0) {
		return runParallelTask(store, parallelNames, params, ctx, overrides);
	}
	if (!chainNames.length && !params.prompt) {
		return {
			content: [
				{
					type: "text",
					text: 'Task needs a prompt (and a subagent_type unless you want auto-pick). Example: {"subagent_type": "explorer", "description": "Map auth", "prompt": "..."}.',
				},
			],
			details: { missing: "prompt" },
			isError: true,
		};
	}

	const disk = discoverSubagents(ctx.cwd);
	const { errors } = disk;
	let tempName: string | undefined;
	if (params.temp_definition !== undefined) {
		const registered = registerTemp(
			params.temp_definition,
			disk.subagents.map((s) => s.name),
			callerTools(ctx),
		);
		if (!registered.ok) {
			return {
				content: [{ type: "text", text: `Temp definition refused: ${registered.error}` }],
				details: { temp: "refused", offender: registered.error },
				isError: true,
			};
		}
		if (params.subagent_type && params.subagent_type !== registered.sub.name) {
			return {
				content: [
					{
						type: "text",
						text: `temp_definition defines "${registered.sub.name}" but subagent_type says "${params.subagent_type}". Pass one of them, not both.`,
					},
				],
				details: { temp: registered.sub.name, subagent_type: params.subagent_type },
				isError: true,
			};
		}
		tempName = registered.sub.name;
	}
	const subagents = withTemps(disk).subagents;
	if (chainNames.length >= 2) {
		return runChainTask(store, chainNames, params, signal ?? undefined, ctx, subagents, overrides);
	}
	let dispatchEcho: { chosen: string; rule: string; matched: string } | undefined;
	let wanted = chainNames[0] ?? params.subagent_type ?? tempName;
	if (!wanted) {
		const picked = pickFromPrompt(
			`${params.description ?? ""} ${params.prompt}`,
			subagents.map((s) => s.name),
		);
		if ("error" in picked) return picked.error;
		wanted = picked.name;
		dispatchEcho = picked.echo;
	}
	const found = subagents.find((s) => s.name === wanted);
	if (!found) {
		return unknownSubagentResult(wanted, subagents, errors);
	}
	const global = readGlobalConfig(ctx.cwd, undefined, {
		trusted: ctx.isProjectTrusted?.() === true,
	});
	const sub = applyRunOverrides(withGlobalConfig(found, global), overrides);
	const cap = global.liveCap ?? MAX_LIVE_TASKS;

	if (params.resume) {
		useFooterUI(ctx.ui);
		const r = await resumeTask(
			store,
			params.resume,
			sub.name,
			params.prompt,
			ctx,
			overrides,
			returnFields,
		);
		if ("error" in r) {
			return {
				content: [{ type: "text", text: r.error }],
				details: { resume: params.resume },
				isError: true,
			};
		}
		return {
			content: [{ type: "text", text: `Resumed as ${r.taskId}. Poll with TaskOutput.` }],
			details: { task_id: r.taskId, resumed_from: params.resume, subagent_type: sub.name },
		};
	}

	useFooterUI(ctx.ui);
	if (params.run_in_background === true) {
		if (!store.canStart(cap)) {
			return {
				content: [
					{
						type: "text",
						text: `Too many live tasks (max ${cap}). Poll or wait for one to finish first.`,
					},
				],
				details: { live_cap: cap },
				isError: true,
			};
		}
		const taskId = await launchBackground(
			store,
			sub,
			params.description,
			params.prompt,
			ctx.cwd,
			ctx,
			{
				dispatch: dispatchEcho,
				contract: returnFields,
			},
		);
		return {
			content: [{ type: "text", text: `Started ${taskId} (${sub.name}). Poll with TaskOutput.` }],
			details: {
				task_id: taskId,
				subagent_type: sub.name,
				status: "running",
				dispatch: dispatchEcho,
			},
		};
	}

	useFooterUI(ctx.ui);
	const runKey = newRunKey();
	const rec = newRecord(
		sub,
		params.description,
		ctx.cwd,
		"foreground",
		ctx.sessionManager.getSessionId(),
	);
	try {
		store.add(rec);
		rec.startedAt = Date.now();
		store.touch();
		markKind(sub.name, "foreground");
		const result = await runSubagent(
			sub,
			params.prompt,
			ctx.cwd,
			ctx,
			signal ?? undefined,
			runKey,
			rec,
			returnFields,
		);
		store.touch();
		const noteText = result.notes.length > 0 ? `\n\n[notes: ${result.notes.join(" ")}]` : "";
		return {
			content: [{ type: "text", text: capDelivery(`${result.text}${noteText}`) }],
			details: {
				subagent_type: sub.name,
				source: sub.source,
				model: result.model,
				usage: result.usage,
				notes: result.notes,
				...(result.missing ? { missing: result.missing } : {}),
				overrides: overrideNote(overrides) || undefined,
				dispatch: dispatchEcho,
			},
			usage: toUsage(result.usage),
		};
	} catch (err) {
		if (isRunStopped(err)) {
			markStopped(rec, err.why);
			store.touch();
			const text = stoppedToolText(sub.name, err.why);
			return {
				content: [{ type: "text", text }],
				details: { subagent_type: sub.name, task_id: rec.taskId, status: "stopped", error: text },
				isError: true,
			};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {
			content: [{ type: "text", text: `Subagent "${sub.name}" failed: ${message}` }],
			details: { subagent_type: sub.name, error: message },
			isError: true,
		};
	}
}
