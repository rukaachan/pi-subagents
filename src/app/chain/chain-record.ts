/**
 * pi-subagents: the row a chain owns.
 */

import type { SubagentConfig } from "../../domain/subagent/index.ts";
import type { TaskRecord } from "../../domain/task/index.ts";
import { newChainSteps, type ChainSpec } from "./chain-spec.ts";

export function newChainRecord(input: {
	taskId: string;
	spec: ChainSpec;
	subagents: readonly SubagentConfig[];
	cwd: string;
	sessionId: string;
	description: string;
}): TaskRecord | undefined {
	const lead = input.subagents[0];
	if (!lead) return undefined;
	return {
		taskId: input.taskId,
		subagentName: input.spec.steps[0] ?? "chain",
		description: input.description,
		status: "running",
		createdAt: Date.now(),
		startedAt: Date.now(),
		fullDelivered: false,
		subagent: lead,
		cwd: input.cwd,
		sessionId: input.sessionId,
		history: [],
		kind: "chain",
		runId: input.taskId,
		steps: newChainSteps(input.spec),
	};
}
