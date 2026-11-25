/**
 * pi-subagents: the root session's Team tool.
 */

import { createTeamMessageTool as buildTeamMessageTool } from "../infra/team/message/index.ts";
import { createTeamTool as buildTeamTool } from "../infra/team/tools/index.ts";
import { liveMember, teamMessageApi } from "../app/team/channel/index.ts";
import type { SessionRuntime } from "../app/index.ts";
import { startTeamLaunch } from "../app/team/run/index.ts";
import { teamApi } from "../app/team/board/index.ts";

export function createTeamTool(runtime: SessionRuntime) {
	return buildTeamTool({
		...teamApi,
		isLive: (name) => Boolean(liveMember(name)),
		launch: (input, ctx) => startTeamLaunch(runtime.store, input, ctx, runtime.deps),
	});
}

export function createTeamMessageTool(_runtime: SessionRuntime) {
	return buildTeamMessageTool(teamMessageApi);
}
