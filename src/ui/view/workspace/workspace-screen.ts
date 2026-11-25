/**
 * pi-subagents: mission control with Runs and Agent team tabs.
 */

import { boardHeight, renderBoard } from "../board/index.ts";
import type { BoardRow } from "../board/index.ts";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { renderAgentTeamScreen, agentTeamHeight, type AgentTeamRow } from "./agent-team-screen.ts";

export type WorkspaceTab = "runs" | "agent-team";

export type WorkspaceAction =
	| { kind: "open"; taskId: string }
	| { kind: "steer"; taskId: string }
	| { kind: "stop"; taskId: string }
	| { kind: "retry"; taskId: string }
	| { kind: "copy"; taskId: string }
	| { kind: "agent-team-toggle" }
	| { kind: "agent-team-new" }
	| { kind: "agent-team-edit"; taskId: string }
	| { kind: "agent-team-assign"; taskId: string }
	| { kind: "agent-team-claim"; taskId: string }
	| { kind: "agent-team-release"; taskId: string }
	| { kind: "agent-team-complete"; taskId: string }
	| { kind: "agent-team-delete"; taskId: string }
	| { kind: "agent-team-detail"; taskId: string }
	| { kind: "agent-team-open-run"; taskId: string }
	| { kind: "agent-team-start" }
	| { kind: "agent-team-verify"; taskId: string }
	| { kind: "agent-team-advise"; taskId: string }
	| { kind: "finish" }
	| { kind: "close" };

export interface WorkspaceData {
	runs: BoardRow[];
	agentTeam: AgentTeamRow[];
	agentTeamEnabled: boolean;
	summary: { open: number; done: number; enabled: boolean };
}

export interface WorkspaceRender extends WorkspaceData {
	tab: WorkspaceTab;
	width: number;
	height: number;
	runsCursor: number;
	agentTeamCursor: number;
	theme: Pick<import("@earendil-works/pi-coding-agent").Theme, "fg" | "bold">;
	activity?: (taskId: string) => readonly string[] | undefined;
	hidden?: { failed: number; stopped: number; hidden: boolean };
}

export function workspaceHeight(tab: WorkspaceTab, data: WorkspaceData): number {
	return (tab === "runs" ? boardHeight(data.runs) : agentTeamHeight(data.agentTeam)) + 1;
}

function tabsLine(tab: WorkspaceTab, width: number, theme: WorkspaceRender["theme"]): string {
	const label = (text: string, active: boolean) =>
		active ? theme.fg("accent", theme.bold(text)) : theme.fg("dim", text);
	return truncateToWidth(
		` ${label("RUNS", tab === "runs")}  │  ${label("AGENT TEAM", tab === "agent-team")}`,
		width,
		"…",
	);
}

export function renderWorkspace(opts: WorkspaceRender): string[] {
	const baseHeight = Math.max(5, opts.height - 1);
	const base =
		opts.tab === "runs"
			? renderBoard(opts.runs, {
					width: opts.width,
					height: baseHeight,
					cursor: opts.runsCursor,
					theme: opts.theme,
					agentTeam: opts.summary,
					activity: opts.activity,
					...(opts.hidden ? { hidden: opts.hidden } : {}),
				})
			: renderAgentTeamScreen(opts.agentTeam, {
					width: opts.width,
					height: baseHeight,
					cursor: opts.agentTeamCursor,
					theme: opts.theme,
					enabled: opts.agentTeamEnabled,
				});
	const tabs = tabsLine(opts.tab, opts.width, opts.theme);
	return [base[0] ?? "", tabs, ...base.slice(1)];
}
