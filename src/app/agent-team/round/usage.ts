/**
 * pi-subagents: token spend for one round.
 */

import type { AgentTeamBoard, AgentTeamRound } from "../../../domain/agent-team/index.ts";
import type { TaskStorePort } from "../../../domain/task/index.ts";

export function roundUsage(
	board: AgentTeamBoard,
	round: AgentTeamRound,
	store: TaskStorePort,
): number {
	let total = 0;
	for (const taskId of round.taskIds) {
		const task = board.tasks.find((row) => row.id === taskId);
		const rec = task?.runId ? store.get(task.runId) : undefined;
		const usage = rec?.result?.usage;
		if (usage) total += usage.input + usage.output;
	}
	return total;
}
