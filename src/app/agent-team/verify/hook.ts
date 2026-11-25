/**
 * pi-subagents: ask the runtime to start a fresh verification run.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type VerifyHook = (taskId: string, ctx: ExtensionContext) => void;

let hook: VerifyHook | null = null;

export function setAgentTeamVerifyHook(fn: VerifyHook | null): void {
	hook = fn;
}

export function requestAgentTeamVerify(taskId: string, ctx: ExtensionContext): void {
	hook?.(taskId, ctx);
}
