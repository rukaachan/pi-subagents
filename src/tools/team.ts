/**
 * pi-subagents: the root session's Team tool.
 */

import { createTeamMessageTool } from "../infra/team/message/index.ts";
import { createTeamTool } from "../infra/team/tools/index.ts";
import { liveMember, teamMessageApi } from "../app/team/channel/index.ts";
import { store } from "../app/session/index.ts";
import { startTeamLaunch } from "../app/team/run/index.ts";
import { teamApi } from "../app/team/board/index.ts";

export const teamTool = createTeamTool({
	...teamApi,
	isLive: (name) => Boolean(liveMember(name)),
	launch: (input, ctx) => startTeamLaunch(store, input, ctx),
});
export const teamMessageTool = createTeamMessageTool(teamMessageApi);
