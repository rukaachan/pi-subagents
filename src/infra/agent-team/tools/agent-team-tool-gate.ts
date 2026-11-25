/**
 * pi-subagents: refuse board changes from a run that already stopped.
 */

import type { AgentTeamCaller } from "../../../domain/agent-team/index.ts";
import type { AgentTeamApi } from "./agent-team-tool-types.ts";

export function shutDown(api: AgentTeamApi, caller: AgentTeamCaller): string | undefined {
	return !caller.lead && api.canWork && !api.canWork()
		? "This run has stopped; board changes are refused."
		: undefined;
}
