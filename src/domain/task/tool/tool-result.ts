/**
 * pi-subagents: what a tool call returns.
 */

import type { Usage } from "../../run/index.ts";

export interface ToolResult {
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
	isError?: boolean;
	usage?: Usage;
}
