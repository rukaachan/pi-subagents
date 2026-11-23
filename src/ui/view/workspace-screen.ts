/**
 * pi-subagents: mission control with Runs and Team tabs.
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import { boardHeight, renderBoard } from "./board-screen.ts";
import type { BoardRow } from "./board-model.ts";
import { renderTeamScreen, teamHeight, type TeamRow } from "./team-screen.ts";

export type WorkspaceTab = "runs" | "team";

export type WorkspaceAction =
	| { kind: "open"; taskId: string }
	| { kind: "steer"; taskId: string }
	| { kind: "stop"; taskId: string }
	| { kind: "retry"; taskId: string }
	| { kind: "copy"; taskId: string }
	| { kind: "team-toggle" }
	| { kind: "team-new" }
	| { kind: "team-edit"; taskId: string }
	| { kind: "team-assign"; taskId: string }
	| { kind: "team-claim"; taskId: string }
	| { kind: "team-release"; taskId: string }
	| { kind: "team-complete"; taskId: string }
	| { kind: "team-delete"; taskId: string }
	| { kind: "team-detail"; taskId: string }
	| { kind: "team-start" }
	| { kind: "finish" }
	| { kind: "close" };

export interface WorkspaceData {
	runs: BoardRow[];
	team: TeamRow[];
	teamEnabled: boolean;
	summary: { open: number; done: number; enabled: boolean };
}

export interface WorkspaceRender extends WorkspaceData {
	tab: WorkspaceTab;
	width: number;
	height: number;
	runsCursor: number;
	teamCursor: number;
	theme: Pick<import("@earendil-works/pi-coding-agent").Theme, "fg" | "bold">;
}

export function workspaceHeight(tab: WorkspaceTab, data: WorkspaceData): number {
	return (tab === "runs" ? boardHeight(data.runs) : teamHeight(data.team)) + 1;
}

function tabsLine(tab: WorkspaceTab, width: number, theme: WorkspaceRender["theme"]): string {
	const label = (text: string, active: boolean) =>
		active ? theme.fg("accent", theme.bold(text)) : theme.fg("dim", text);
	return truncateToWidth(
		` ${label("RUNS", tab === "runs")}  │  ${label("TEAM", tab === "team")}`,
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
					team: opts.summary,
				})
			: renderTeamScreen(opts.team, {
					width: opts.width,
					height: baseHeight,
					cursor: opts.teamCursor,
					theme: opts.theme,
					enabled: opts.teamEnabled,
				});
	const tabs = tabsLine(opts.tab, opts.width, opts.theme);
	return [base[0] ?? "", tabs, ...base.slice(1)];
}
