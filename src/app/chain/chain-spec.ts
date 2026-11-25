/**
 * pi-subagents: chain shape and step prompts.
 */

import type { ChainStep } from "../../domain/task/index.ts";

export interface ChainSpec {
	steps: string[];
	prompt: string;
}

/** What a chain step passes on; longer reports are cut. */
export const MAX_PRIOR_REPORT = 8000;

export function stepPrompt(spec: ChainSpec, idx: number, priorReport?: string): string {
	if (idx === 0) return spec.prompt;
	const prior = priorReport ? priorReport.slice(0, MAX_PRIOR_REPORT) : "(no prior report)";
	return `Prior step report (may be cut):\n${prior}\n\nOriginal task: ${spec.prompt}\n\nContinue from the report above. Do your own step and return one short report.`;
}

export function newChainSteps(spec: ChainSpec): ChainStep[] {
	return spec.steps.map((name, idx) => ({
		idx,
		subagentName: name,
		prompt: stepPrompt(spec, idx),
		status: idx === 0 ? "running" : "pending",
	}));
}

export interface ChainRun {
	taskId: string;
	done: Promise<void>;
}
