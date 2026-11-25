/**
 * pi-subagents: what a tool call returns.
 */

import type { toUsage } from "../../infra/host/index.ts";

export interface ToolResult {
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
	isError?: boolean;
	usage?: ReturnType<typeof toUsage>;
}
