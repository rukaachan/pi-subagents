/**
 * pi-subagents: the subagent alias.
 */

import type { RunOverrides } from "../domain/tiers.ts";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { runChainTask, unknownSubagentResult } from "../app/chain-task.ts";
import { markKind } from "../app/ledger.ts";
import { store } from "../app/live-store.ts";
import { runSubagent } from "../app/run.ts";
import { newRecord } from "../app/task-record.ts";
import { parseBudget } from "../domain/subagent/budget.ts";
import { discoverSubagents } from "../infra/subagent-files.ts";
import { withTemps } from "../domain/temp.ts";
import { readGlobalConfig, withGlobalConfig } from "../app/global-config.ts";
import {
	applyRunOverrides,
	overrideNote,
	parseCodemodeOverride,
	parseComplexity,
} from "../domain/tiers.ts";
import { subagentArgs } from "../infra/host-shim.ts";
import { useFooterUI } from "../telemetry/progress.ts";
import { newRunKey } from "../telemetry/track.ts";
import { resultShell, toUsage, usageFooter } from "../ui/tool-results.ts";
import { Text } from "@earendil-works/pi-tui";
import { shortText } from "../ui/view/format.ts";
import { DELEGATION_RULE } from "./task/meta.ts";
import { subagentAliasParameters } from "./subagent-alias-schema.ts";

export const subagentAliasTool = defineTool({
	name: "subagent",
	label: "Subagent",
	description: [
		"Alias of Task for models that know Pi's sample subagent tool.",
		"Single mode: { agent, task }. Chain: pass chain: [explorer, worker]. For background or resume, use Task.",
		`agent = subagent name (run /subagents to list). task = full prompt.`,
		"Summarize the result for the user; do not paste raw output.",
	].join(" "),
	promptSnippet: "subagent(agent, task): alias of Task. Single mode, or chain: [a, b].",
	// The same rule as Task. Pi dedupes identical rules, so a model that
	// reads both tools still sees the line once.
	promptGuidelines: [DELEGATION_RULE],
	prepareArguments: (args) => subagentArgs(args) as never,
	parameters: subagentAliasParameters,
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		const budget = parseBudget(params.budget);
		if (typeof budget === "string") {
			return {
				content: [{ type: "text", text: budget }],
				details: { bad_budget: params.budget },
				isError: true,
			};
		}
		const tier = parseComplexity(params.complexity);
		if (tier === "bad") {
			return {
				content: [
					{
						type: "text",
						text: `Unknown complexity "${String(params.complexity)}". Use light, medium, or heavy.`,
					},
				],
				details: { bad_complexity: params.complexity },
				isError: true,
			};
		}
		const codemode = parseCodemodeOverride(params.codemode);
		if (codemode === "bad") {
			return {
				content: [
					{
						type: "text",
						text: `Unknown codemode ${JSON.stringify(params.codemode)}. Use off, on, or only.`,
					},
				],
				details: { bad_codemode: params.codemode },
				isError: true,
			};
		}
		const overrides: RunOverrides = {
			model: params.model,
			complexity: tier,
			budget,
			codemode: codemode ?? undefined,
		};
		if (!params.agent || !params.task) {
			return {
				content: [
					{
						type: "text",
						text: 'subagent needs agent and task. Example: {"agent": "explorer", "task": "..."}.',
					},
				],
				details: { missing: "agent/task" },
				isError: true,
			};
		}
		if (params.tasks !== undefined && params.tasks !== null) {
			return {
				content: [
					{
						type: "text",
						text: "Parallel tasks[] is not supported. Run one Task per call instead.",
					},
				],
				details: { unsupported: "tasks" },
				isError: true,
			};
		}
		const { subagents, errors } = withTemps(discoverSubagents(ctx.cwd));
		const chainNames = Array.isArray(params.chain)
			? params.chain.filter((n): n is string => typeof n === "string" && Boolean(n.trim()))
			: [];
		if (chainNames.length >= 2) {
			return runChainTask(
				store,
				chainNames,
				{ description: params.description ?? chainNames.join(" → "), prompt: params.task },
				signal ?? undefined,
				ctx,
				subagents,
				overrides,
			);
		}
		const found = subagents.find((s) => s.name === params.agent);
		if (!found) {
			return unknownSubagentResult(params.agent, subagents, errors);
		}
		const sub = applyRunOverrides(withGlobalConfig(found, readGlobalConfig(ctx.cwd)), overrides);
		useFooterUI(ctx.ui);
		try {
			const runKey = newRunKey();
			const rec = newRecord(sub, params.description ?? params.agent, ctx.cwd, "alias");
			store.add(rec);
			markKind(sub.name, "alias");
			const result = await runSubagent(
				sub,
				params.task,
				ctx.cwd,
				ctx,
				signal ?? undefined,
				runKey,
				rec,
			);
			store.touch();
			const noteText = result.notes.length > 0 ? `\n\n[notes: ${result.notes.join(" ")}]` : "";
			return {
				content: [{ type: "text", text: `${result.text}${noteText}` }],
				details: {
					subagent_type: sub.name,
					source: sub.source,
					model: result.model,
					usage: result.usage,
					notes: result.notes,
					overrides: overrideNote(overrides) || undefined,
				},
				usage: toUsage(result.usage),
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `Subagent "${sub.name}" failed: ${message}` }],
				details: { subagent_type: sub.name, error: message },
				isError: true,
			};
		}
	},

	renderCall(args, theme, _context) {
		const name = typeof args.agent === "string" ? args.agent : "...";
		const task = typeof args.task === "string" ? args.task : "";
		const text =
			theme.fg("toolTitle", theme.bold("subagent ")) +
			theme.fg("accent", name) +
			theme.fg("dim", ` ${shortText(task, 60)}`);
		return new Text(text, 0, 0);
	},

	renderResult(result, { expanded }, theme, _context) {
		const details = result.details as
			| {
					subagent_type?: string;
					error?: string;
					unsupported?: string;
					usage?: {
						input: number;
						output: number;
						cacheRead: number;
						cacheWrite: number;
						cost: number;
						turns: number;
					};
					model?: string;
			  }
			| undefined;
		const text = result.content[0];
		const body = text?.type === "text" ? text.text : "(no output)";
		if (
			details?.error ||
			details?.unsupported ||
			body.startsWith("Unknown subagent") ||
			body.startsWith('Subagent "') ||
			body.includes("not supported")
		) {
			return new Text(
				`${theme.fg("error", "✗ subagent")} ${theme.fg("dim", shortText(body, 200))}`,
				0,
				0,
			);
		}
		const head = `${theme.fg("success", "✓ subagent")}${usageFooter(theme, details?.usage, details?.model)}`;
		return resultShell(theme, head, body, 2000, 160, expanded);
	},
});
