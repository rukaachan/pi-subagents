/**
 * pi-subagents: mission control with Runs and Agent team tabs.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import {
	boardHeight,
	boardHint,
	boardSummary,
	renderBoardBody,
	type BoardRow,
} from "../board/index.ts";
import { fitHint, screenHeader, tabsLine } from "../design/index.ts";
import {
	agentTeamHeight,
	agentTeamHint,
	agentTeamSummary,
	renderAgentTeamBody,
	type AgentTeamRow,
	type AgentTeamRoundInfo,
} from "./agent-team-screen.ts";

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
	| { kind: "help" }
	| { kind: "finish" }
	| { kind: "close" };

export interface WorkspaceData {
	runs: BoardRow[];
	agentTeam: AgentTeamRow[];
	agentTeamRounds?: AgentTeamRoundInfo[];
	agentTeamEnabled: boolean;
	summary: { open: number; done: number; enabled: boolean; facts?: number };
}

export interface WorkspaceRender extends WorkspaceData {
	tab: WorkspaceTab;
	width: number;
	height: number;
	runsCursor: number;
	agentTeamCursor: number;
	theme: Pick<Theme, "fg" | "bold">;
	hidden?: { failed: number; stopped: number; hidden: boolean };
}

export function workspaceHeight(tab: WorkspaceTab, data: WorkspaceData): number {
	return tab === "runs" ? boardHeight(data.runs) : agentTeamHeight(data.agentTeam);
}

export function renderWorkspace(opts: WorkspaceRender): string[] {
	const height = Math.max(5, opts.height);
	const bodyHeight = Math.max(1, height - 4);
	const runs = opts.tab === "runs";
	const summary = runs
		? boardSummary(opts.runs, opts.hidden)
		: agentTeamSummary(opts.agentTeam, opts.agentTeamEnabled, opts.summary.facts);
	const body = runs
		? renderBoardBody(opts.runs, {
				width: opts.width,
				height: bodyHeight,
				cursor: opts.runsCursor,
				theme: opts.theme,
				...(opts.hidden ? { hidden: opts.hidden } : {}),
			})
		: renderAgentTeamBody(opts.agentTeam, {
				width: opts.width,
				height: bodyHeight,
				cursor: opts.agentTeamCursor,
				theme: opts.theme,
				...(opts.agentTeamRounds ? { rounds: opts.agentTeamRounds } : {}),
			});
	const hint = runs
		? boardHint(opts.runs, opts.runsCursor, opts.hidden)
		: agentTeamHint(opts.agentTeam, opts.agentTeamCursor);
	const out = [
		screenHeader("pi-subagents", summary, opts.width, opts.theme),
		tabsLine(["RUNS", "AGENT TEAM"], runs ? 0 : 1, opts.width, opts.theme),
		"",
		...body,
		fitHint(hint, opts.width, opts.theme),
	];
	return out.slice(0, height).map((line) => truncateToWidth(line, opts.width, ""));
}
