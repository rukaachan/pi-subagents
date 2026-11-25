/**
 * pi-subagents: the root session's AgentTeam tool.
 */

import { createAgentTeamMessageTool as buildAgentTeamMessageTool } from "../infra/agent-team/message/index.ts";
import { createAgentTeamTool as buildAgentTeamTool } from "../infra/agent-team/tools/index.ts";
import { liveMember, agentTeamMessageApi } from "../app/agent-team/channel/index.ts";
import type { SessionRuntime } from "../app/index.ts";
import { startAgentTeamLaunch } from "../app/agent-team/run/index.ts";
import { startAgentTeamVerification } from "../app/agent-team/verify-run/index.ts";
import { adviseAgentTeam } from "../app/agent-team/advisor/index.ts";
import { agentTeamApi } from "../app/agent-team/board/index.ts";

export function createAgentTeamTool(runtime: SessionRuntime) {
	return buildAgentTeamTool({
		...agentTeamApi,
		isLive: (name) => Boolean(liveMember(name)),
		launch: (input, ctx) => startAgentTeamLaunch(runtime.store, input, ctx, runtime.deps),
		startVerify: (taskId, ctx) =>
			startAgentTeamVerification(runtime.store, taskId, ctx, runtime.deps),
		advise: (question, taskId, ctx) =>
			adviseAgentTeam(runtime.store, question, taskId, ctx, runtime.deps),
	});
}

export function createAgentTeamMessageTool(_runtime: SessionRuntime) {
	return buildAgentTeamMessageTool(agentTeamMessageApi);
}
