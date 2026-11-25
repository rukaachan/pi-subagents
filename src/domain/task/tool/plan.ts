/**
 * pi-subagents: checking a Task request before anything starts.
 */

import { parseBudget } from "../../subagent/index.ts";
import { parseReturn } from "../../run/index.ts";
import {
	applyRunOverrides,
	overrideNote,
	parseCodemodeOverride,
	parseComplexity,
	type RunOverrides,
} from "../../run/index.ts";
import { parallelNamesFrom } from "./names.ts";
import type { TaskParams } from "./schema.ts";
import type { ToolResult } from "./tool-result.ts";

export interface TaskPlan {
	overrides: RunOverrides;
	chainNames: string[];
	parallelNames: string[];
	returnFields: string[];
}

export type PlanResult = { ok: true; plan: TaskPlan } | { ok: false; error: ToolResult };

export function planTask(params: TaskParams): PlanResult {
	const tier = parseComplexity(params.complexity);
	if (tier === "bad") {
		return {
			ok: false,
			error: {
				content: [
					{
						type: "text",
						text: `Unknown complexity "${String(params.complexity)}". Use light, medium, or heavy.`,
					},
				],
				details: { bad_complexity: params.complexity },
				isError: true,
			},
		};
	}
	const codemode = parseCodemodeOverride(params.codemode);
	if (codemode === "bad") {
		return {
			ok: false,
			error: {
				content: [
					{
						type: "text",
						text: `Unknown codemode ${JSON.stringify(params.codemode)}. Use off, on, or only.`,
					},
				],
				details: { bad_codemode: params.codemode },
				isError: true,
			},
		};
	}
	const budget = parseBudget(params.budget);
	if (typeof budget === "string") {
		return {
			ok: false,
			error: {
				content: [{ type: "text", text: budget }],
				details: { bad_budget: params.budget },
				isError: true,
			},
		};
	}
	const contract = parseReturn(params.return);
	if ("error" in contract) {
		return {
			ok: false,
			error: {
				content: [{ type: "text", text: contract.error }],
				details: { bad_return: params.return },
				isError: true,
			},
		};
	}
	const overrides: RunOverrides = {
		model: params.model,
		complexity: tier,
		budget,
		codemode: codemode ?? undefined,
	};
	const chainNames = Array.isArray(params.chain)
		? params.chain.filter((n): n is string => typeof n === "string" && Boolean(n.trim()))
		: [];
	const parallelNames = parallelNamesFrom(params.parallel);
	if (chainNames.length > 0 && parallelNames.length > 0) {
		return {
			ok: false,
			error: {
				content: [
					{
						type: "text",
						text: "Pass chain or parallel, not both. chain runs steps in order; parallel runs them at once.",
					},
				],
				details: { chain: chainNames, parallel: parallelNames },
				isError: true,
			},
		};
	}
	if (parallelNames.length > 0 && params.resume) {
		return {
			ok: false,
			error: {
				content: [
					{ type: "text", text: "Resume is single-task: pass one task_id without parallel[]." },
				],
				details: { resume: params.resume, parallel: parallelNames },
				isError: true,
			},
		};
	}
	if (contract.fields.length > 0 && (chainNames.length > 0 || parallelNames.length > 0)) {
		return {
			ok: false,
			error: {
				content: [
					{
						type: "text",
						text: "return is single-task: name the fields on one subagent (or a resume), not on chain[] or parallel[].",
					},
				],
				details: { return: contract.fields, chain: chainNames, parallel: parallelNames },
				isError: true,
			},
		};
	}
	if (!chainNames.length && !params.prompt) {
		return {
			ok: false,
			error: {
				content: [
					{
						type: "text",
						text: 'Task needs a prompt (and a subagent_type unless you want auto-pick). Example: {"subagent_type": "explorer", "description": "Map auth", "prompt": "..."}.',
					},
				],
				details: { missing: "prompt" },
				isError: true,
			},
		};
	}
	return {
		ok: true,
		plan: { overrides, chainNames, parallelNames, returnFields: contract.fields },
	};
}

export { applyRunOverrides, overrideNote };
