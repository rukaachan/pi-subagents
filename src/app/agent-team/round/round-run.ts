/**
 * pi-subagents: open one explicit team round.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ChildDeps } from "../../run/index.ts";
import {
	MAX_AGENT_TEAM_DESCRIPTION,
	type AgentTeamRound,
} from "../../../domain/agent-team/index.ts";
import {
	clampRoundBudget,
	nextRoundId,
	roundRefusal,
} from "../../../domain/agent-team/lifecycle/index.ts";
import type { TaskStorePort } from "../../../domain/task/index.ts";
import type {
	AgentTeamRoundInput,
	AgentTeamRoundResult,
} from "../../../infra/agent-team/tools/index.ts";
import { agentTeamBoard, agentTeamChanged } from "../board/index.ts";
import { journalWrite } from "../../../telemetry/journal/index.ts";
import { startAgentTeamLaunch } from "../run/index.ts";
import { roundUsage } from "./usage.ts";
import { readGlobalConfig } from "../../session/index.ts";

export interface AgentTeamRoundEvent {
	roundId: number;
	taskIds: string[];
	tokens: number;
	ms: number;
	forced?: boolean;
	ok: boolean;
	error?: string;
}

export function journalAgentTeamRound(entry: AgentTeamRoundEvent): void {
	journalWrite({
		event: "agent_team_round",
		roundId: entry.roundId,
		taskIds: entry.taskIds,
		tokens: entry.tokens,
		ms: entry.ms,
		...(entry.forced ? { forced: true } : {}),
		ok: entry.ok,
		...(entry.error ? { error: entry.error } : {}),
	});
}

export async function startAgentTeamRound(
	store: TaskStorePort,
	input: AgentTeamRoundInput,
	ctx: ExtensionContext,
	deps: ChildDeps,
): Promise<AgentTeamRoundResult> {
	const prompt = input.prompt.trim();
	if (!prompt) return { ok: false, error: "AgentTeam round needs a prompt." };
	if (prompt.length > MAX_AGENT_TEAM_DESCRIPTION) {
		return {
			ok: false,
			error: `AgentTeam round prompt is limited to ${MAX_AGENT_TEAM_DESCRIPTION} characters.`,
		};
	}
	const board = agentTeamBoard();
	const roundId = nextRoundId(board);
	if (roundId === undefined) return { ok: false, error: "Agent team has used all rounds." };
	const now = Date.now();
	const previous = board.rounds.at(-1);
	const spent = previous ? roundUsage(board, previous, store) : 0;
	const refusal = roundRefusal(board, now, spent, input.force === true);
	if (refusal) return { ok: false, error: refusal };
	const global = readGlobalConfig(ctx.cwd);
	const budget = clampRoundBudget(
		input.budgetTokens ?? global.roundBudgetTokens,
		input.budgetMinutes ?? global.roundBudgetMinutes,
	);
	const result = await startAgentTeamLaunch(
		store,
		{
			prompt,
			roster: input.roster,
			directions: input.directions,
			roundId,
			brief: input.brief,
			isolation: input.isolation,
		},
		ctx,
		deps,
	);
	if (!result.ok) return result;
	const brief = input.brief?.trim();
	const round: AgentTeamRound = {
		id: roundId,
		prompt,
		taskIds: result.tasks.map((task) => task.taskId),
		...(brief ? { brief } : {}),
		budget,
		startedAt: now,
	};
	board.rounds.push(round);
	agentTeamChanged();
	journalAgentTeamRound({
		roundId,
		taskIds: round.taskIds,
		tokens: budget.tokens,
		ms: budget.ms,
		...(input.force ? { forced: true } : {}),
		ok: true,
	});
	return { ...result, roundId, budget };
}
