/**
 * pi-subagents: the child session port.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SubagentConfig } from "../../domain/subagent/index.ts";
import type { ChildExtras, LiveChild } from "../../infra/host/index.ts";

export interface ChildDeps {
	child: ChildSessionPort;
}

export interface ChildSessionPort {
	create(
		sub: SubagentConfig,
		cwd: string,
		ctx: ExtensionContext,
		extras?: ChildExtras,
	): Promise<LiveChild>;
}
