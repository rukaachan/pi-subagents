/**
 * pi-subagents: refuse board changes from a run that already stopped.
 */

import type { TeamCaller } from "../domain/team.ts";
import type { TeamApi } from "./team-tool-types.ts";

export function shutDown(api: TeamApi, caller: TeamCaller): string | undefined {
	return !caller.lead && api.canWork && !api.canWork()
		? "This run has stopped; board changes are refused."
		: undefined;
}
