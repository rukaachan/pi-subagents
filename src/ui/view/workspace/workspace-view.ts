/**
 * pi-subagents: mission control input and render loop.
 */

import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { BoardRow } from "../board/index.ts";
import type { AgentTeamRow } from "./agent-team-screen.ts";
import {
	renderWorkspace,
	type WorkspaceAction,
	type WorkspaceData,
	type WorkspaceRender,
	type WorkspaceTab,
} from "./workspace-screen.ts";

export interface WorkspaceViewDeps {
	tab: WorkspaceTab;
	runs: () => BoardRow[];
	agentTeam: () => AgentTeamRow[];
	agentTeamEnabled: () => boolean;
	summary: () => { open: number; done: number; enabled: boolean; facts?: number };
	height: () => number;
	hidden?: () => { failed: number; stopped: number; hidden: boolean };
	toggleHidden?: () => void;
	theme: WorkspaceRender["theme"];
	render: () => void;
	onAction: (action: WorkspaceAction) => void;
	subscribe?: (fn: () => void) => () => void;
	poll?: boolean;
	alive?: () => boolean;
}

export interface WorkspaceView {
	render: (width: number) => string[];
	handleInput: (data: string) => void;
	sync: () => void;
	dispose: () => void;
}

const POLL_MS = 1000;

export function createWorkspaceView(deps: WorkspaceViewDeps): WorkspaceView {
	let tab = deps.tab;
	let runsCursor = 0;
	let agentTeamCursor = 0;
	let closed = false;
	let lastKey = "";
	let timer: ReturnType<typeof setInterval> | undefined;
	const unsubscribe = deps.subscribe?.(() => sync());
	if (deps.poll) {
		timer = setInterval(() => sync(), POLL_MS);
		timer.unref?.();
	}

	function rows(): readonly (BoardRow | AgentTeamRow)[] {
		return tab === "runs" ? deps.runs() : deps.agentTeam();
	}

	function current(): BoardRow | AgentTeamRow | undefined {
		return rows()[tab === "runs" ? runsCursor : agentTeamCursor];
	}

	function data(): WorkspaceData {
		return {
			runs: deps.runs(),
			agentTeam: deps.agentTeam(),
			agentTeamEnabled: deps.agentTeamEnabled(),
			summary: deps.summary(),
		};
	}

	function keyOf(): string {
		const all = data();
		const hidden = deps.hidden?.();
		return [
			tab,
			runsCursor,
			agentTeamCursor,
			all.agentTeamEnabled,
			`${hidden?.failed ?? 0}:${hidden?.stopped ?? 0}:${hidden?.hidden ? 1 : 0}`,
			all.runs
				.map((row) => `${row.taskId}:${row.section}:${row.turns}:${row.elapsedSec}`)
				.join("|"),
			all.agentTeam
				.map(
					(row) =>
						`${row.view.task.id}:${row.view.task.revision}:${row.view.task.status}:${row.live ? 1 : 0}`,
				)
				.join("|"),
		].join("|");
	}

	function hiddenTotal(): number {
		const hidden = deps.hidden?.();
		return hidden ? hidden.failed + hidden.stopped : 0;
	}

	function sync(): void {
		if (closed) return;
		if (deps.alive && !deps.alive()) return;
		const key = keyOf();
		if (key === lastKey) return;
		lastKey = key;
		deps.render();
	}

	function emit(action: WorkspaceAction): void {
		if (closed) return;
		closed = true;
		deps.onAction(action);
	}

	function move(delta: number): void {
		const list = rows();
		if (list.length === 0) return;
		if (tab === "runs") runsCursor = Math.max(0, Math.min(runsCursor + delta, list.length - 1));
		else agentTeamCursor = Math.max(0, Math.min(agentTeamCursor + delta, list.length - 1));
		sync();
	}

	function switchTab(next: WorkspaceTab): void {
		if (tab === next) return;
		tab = next;
		sync();
	}

	function handleRuns(key: string): void {
		const row = current() as BoardRow | undefined;
		if (key === "g") {
			runsCursor = 0;
			return sync();
		}
		if (key === "G") {
			runsCursor = Math.max(0, deps.runs().length - 1);
			return sync();
		}
		if (key === "n") return emit({ kind: "finish" });
		if (!row && matchesKey(key, Key.enter)) return emit({ kind: "finish" });
		if (!row) return;
		if (matchesKey(key, Key.enter) && row.openable)
			return emit({ kind: "open", taskId: row.taskId });
		if (key === "s" && row.steerable) return emit({ kind: "steer", taskId: row.taskId });
		if (key === "x" && row.stoppable) return emit({ kind: "stop", taskId: row.taskId });
		if (key === "r" && row.retryable) return emit({ kind: "retry", taskId: row.taskId });
		if (key === "c") return emit({ kind: "copy", taskId: row.taskId });
	}

	function handleAgentTeam(key: string): void {
		const row = current() as AgentTeamRow | undefined;
		const taskId = row?.view.task.id;
		if (key === "g") {
			agentTeamCursor = 0;
			return sync();
		}
		if (key === "G") {
			agentTeamCursor = Math.max(0, deps.agentTeam().length - 1);
			return sync();
		}
		if (key === "t") return emit({ kind: "agent-team-toggle" });
		if (key === "n") return emit({ kind: "agent-team-new" });
		if (key === "s") return emit({ kind: "agent-team-start" });
		if (!taskId) return;
		if (matchesKey(key, Key.enter)) return emit({ kind: "agent-team-detail", taskId });
		if (key === "o") return emit({ kind: "agent-team-open-run", taskId });
		if (key === "e") return emit({ kind: "agent-team-edit", taskId });
		if (key === "a") return emit({ kind: "agent-team-assign", taskId });
		if (key === "c") return emit({ kind: "agent-team-claim", taskId });
		if (key === "r") return emit({ kind: "agent-team-release", taskId });
		if (key === "x") return emit({ kind: "agent-team-complete", taskId });
		if (key === "v") return emit({ kind: "agent-team-verify", taskId });
		if (key === "i") return emit({ kind: "agent-team-advise", taskId });
		if (key === "d") return emit({ kind: "agent-team-delete", taskId });
	}

	return {
		render(width: number): string[] {
			const all = data();
			if (tab === "runs") runsCursor = Math.max(0, Math.min(runsCursor, all.runs.length - 1));
			else agentTeamCursor = Math.max(0, Math.min(agentTeamCursor, all.agentTeam.length - 1));
			lastKey = keyOf();
			return renderWorkspace({
				...all,
				tab,
				width,
				height: deps.height(),
				runsCursor,
				agentTeamCursor,
				theme: deps.theme,
				...(deps.hidden ? { hidden: deps.hidden() } : {}),
			});
		},

		handleInput(key: string): void {
			if (closed) return;
			if (matchesKey(key, Key.escape) || key === "\x03") return emit({ kind: "close" });
			if (matchesKey(key, Key.tab)) {
				switchTab(tab === "runs" ? "agent-team" : "runs");
				return;
			}
			if (key === "1") return switchTab("runs");
			if (key === "2") return switchTab("agent-team");
			if (key === "?") return emit({ kind: "help" });
			if (key === "f") return emit({ kind: "finish" });
			if (key === "e" && tab === "runs" && hiddenTotal()) {
				deps.toggleHidden?.();
				runsCursor = Math.max(0, Math.min(runsCursor, deps.runs().length - 1));
				return;
			}
			if (matchesKey(key, Key.up) || key === "k") return move(-1);
			if (matchesKey(key, Key.down) || key === "j") return move(1);
			if (tab === "runs") handleRuns(key);
			else handleAgentTeam(key);
		},

		sync,

		dispose(): void {
			closed = true;
			if (timer) clearInterval(timer);
			timer = undefined;
			unsubscribe?.();
		},
	};
}
