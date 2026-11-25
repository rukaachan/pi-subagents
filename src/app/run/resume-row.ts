/**
 * pi-subagents: the row a resumed run owns.
 */

import type { TaskRecord } from "../../domain/task/index.ts";
import type { SubagentConfig } from "../../domain/subagent/index.ts";

export function resumeRecord(input: {
	rec: TaskRecord;
	followId: string;
	sub: SubagentConfig;
	prompt: string;
	sessionId: string;
}): TaskRecord {
	return {
		taskId: input.followId,
		subagentName: input.rec.subagentName,
		description: `resume of ${input.rec.taskId}`,
		status: "running",
		createdAt: Date.now(),
		fullDelivered: false,
		subagent: input.sub,
		cwd: input.rec.cwd,
		sessionId: input.sessionId,
		history: [],
		kind: "background",
		prompt: input.prompt,
		...(input.rec.runId ? { runId: input.rec.runId } : {}),
		...(input.rec.agentTeamTaskId ? { agentTeamTaskId: input.rec.agentTeamTaskId } : {}),
		...(input.rec.agentTeamRole ? { agentTeamRole: input.rec.agentTeamRole } : {}),
		...(input.rec.agentTeamOrigin ? { agentTeamOrigin: input.rec.agentTeamOrigin } : {}),
	};
}
