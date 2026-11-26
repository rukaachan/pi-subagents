/**
 * pi-subagents: round budgets and the next-round gate.
 */

import {
	DEFAULT_ROUND_MS,
	DEFAULT_ROUND_TOKENS,
	MAX_AGENT_TEAM_ROUNDS,
	MAX_ROUND_MS,
	MAX_ROUND_TOKENS,
	type AgentTeamBoard,
	type AgentTeamRound,
} from "../index.ts";

export interface RoundBudget {
	tokens: number;
	ms: number;
}

export function clampRoundBudget(tokens?: number, minutes?: number): RoundBudget {
	const tokenValue =
		typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0
			? Math.min(Math.floor(tokens), MAX_ROUND_TOKENS)
			: DEFAULT_ROUND_TOKENS;
	const minuteValue =
		typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
			? Math.min(Math.floor(minutes), MAX_ROUND_MS / 60_000)
			: DEFAULT_ROUND_MS / 60_000;
	return { tokens: tokenValue, ms: minuteValue * 60_000 };
}

/** The lowest free id, or undefined once every round slot is used. */
export function nextRoundId(board: AgentTeamBoard): number | undefined {
	const used = new Set(board.rounds.map((round) => round.id));
	for (let id = 1; id <= MAX_AGENT_TEAM_ROUNDS; id += 1) {
		if (!used.has(id)) return id;
	}
	return undefined;
}

export function roundSpentTokens(
	round: AgentTeamRound,
	usageOf: (taskId: string) => number,
): number {
	return round.taskIds.reduce((sum, taskId) => sum + Math.max(0, usageOf(taskId)), 0);
}

/** Why another round may not open; force skips only the previous budget. */
export function roundRefusal(
	board: AgentTeamBoard,
	now: number,
	spentTokens: number,
	force: boolean,
): string | undefined {
	if (board.rounds.length >= MAX_AGENT_TEAM_ROUNDS) {
		return `Agent team has used all ${MAX_AGENT_TEAM_ROUNDS} rounds.`;
	}
	if (force) return undefined;
	const previous = board.rounds.at(-1);
	if (!previous) return undefined;
	if (spentTokens >= previous.budget.tokens) {
		return `Round ${previous.id} used ${spentTokens} of ${previous.budget.tokens} tokens; force the next round or raise the budget.`;
	}
	const elapsed = Math.max(0, now - previous.startedAt);
	if (elapsed >= previous.budget.ms) {
		const ran = Math.round(elapsed / 60_000);
		const cap = Math.round(previous.budget.ms / 60_000);
		return `Round ${previous.id} ran ${ran} of ${cap} minutes; force the next round or raise the budget.`;
	}
	return undefined;
}
