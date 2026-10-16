/**
 * pi-subagents: granting codemode, and what it costs at runtime.
 */
import { clampToolsForAutonomy, TOOL_GROUPS } from "./config.ts";
import type { SubagentConfig } from "./config.ts";

// Codemode workers alive per pi process.
/** The host's own limit: two codemode workers per pi process. */
export const HOST_CODEMODE_WORKERS = 2;

/** Wide enough for the live task cap; the operator's env value wins. */
export const CODEMODE_WORKERS_DEFAULT = 8;

export type CodemodeMode = "on" | "only";

export function planCodemode(
	sub: SubagentConfig,
	clampedTools: string[] | undefined,
	defaultTools?: string[],
): { toolIds: string[]; addCodemodeTool: boolean; mode: CodemodeMode } | null {
	if (sub.codemode === false) return null;
	// The default is scripting alone: measured, it costs what no
	// scripting costs and turns fewer times (README, Codemode).
	const mode: CodemodeMode = sub.codemode === true ? "on" : "only";
	const ids = clampedTools ?? (defaultTools ?? (TOOL_GROUPS["execute"] ?? []).slice()).slice();
	const declared = ids.filter((t) => t !== "codemode");
	const listedCodemode = ids.length !== declared.length;
	// Scripts reach the session's own tool set, never the registry
	// (measured: _getCallableTools filters by the active set), so the
	// clamp holds in every mode: a read-only list stays read-only.
	const toolIds = listedCodemode ? ids : [...ids, "codemode"];
	return { toolIds, addCodemodeTool: true, mode };
}

export const SCRIPT_ROUTE_RULE = `Tool route:
- Your tools run inside codemode scripts, not as direct calls.
- Batch independent reads and searches into ONE script with Promise.allSettled.
- Keep each edit or write in its own script, one change per script.
- tools.bash resolves even when the command fails. Guard it: r.status === "fulfilled" && r.value.exit_code === 0 before reading r.value.output.
- If a result says "Script failed": the return value never ran. Read the error text, fix the code, retry once.`;

export function teachesScriptRoute(prompt: string): boolean {
	return /codemode|script/i.test(prompt);
}

export function withScriptRoute(prompt: string): string {
	if (teachesScriptRoute(prompt)) return prompt;
	return `${prompt.trim()}\n\n${SCRIPT_ROUTE_RULE}`;
}

export function codemodeLegs(legs: SubagentConfig[]): string[] {
	return legs
		.filter((leg) => {
			const { tools } = clampToolsForAutonomy(leg);
			return planCodemode(leg, tools, undefined) !== null;
		})
		.map((leg) => leg.name);
}

export function codemodeContentionNote(legs: string[], workers = CODEMODE_WORKERS_DEFAULT): string {
	if (legs.length <= workers) return "";
	return `\nCodemode: ${legs.length} legs (${legs.join(", ")}) share ${workers} workers per pi process, so the extra scripts wait for a free worker. Raise PI_CODEMODE_MAX_WORKERS for a wider fan-out.`;
}
