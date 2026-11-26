/**
 * pi-subagents: rows for the Agent team tab.
 */

import { liveMember } from "../../../app/agent-team/channel/index.ts";
import { agentTeamBoard, taskList } from "../../../app/agent-team/board/index.ts";
import { roundUsage } from "../../../app/agent-team/round/index.ts";
import { MAX_AGENT_TEAM_TASKS } from "../../../domain/agent-team/index.ts";
import type { TaskStorePort } from "../../../domain/task/index.ts";
import {
	buildAgentTeamRows,
	type AgentTeamRow,
	type AgentTeamRoundInfo,
} from "../../view/workspace/index.ts";

export function agentTeamRows(): AgentTeamRow[] {
	return buildAgentTeamRows(taskList({ limit: MAX_AGENT_TEAM_TASKS }), (name) =>
		Boolean(liveMember(name)),
	);
}

export function roundRows(store: TaskStorePort): AgentTeamRoundInfo[] {
	const board = agentTeamBoard();
	const now = Date.now();
	return board.rounds.map((round) => ({
		id: round.id,
		tokens: round.budget.tokens,
		ms: round.budget.ms,
		spent: roundUsage(board, round, store),
		elapsedMs: Math.max(0, now - round.startedAt),
	}));
}
