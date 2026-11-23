/**
 * pi-subagents: mission control input and render loop.
 */

import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { BoardRow } from "./board-model.ts";
import type { TeamRow } from "./team-screen.ts";
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
	team: () => TeamRow[];
	teamEnabled: () => boolean;
	summary: () => { open: number; done: number; enabled: boolean };
	height: () => number;
	activity?: (taskId: string) => readonly string[] | undefined;
	failed?: () => { total: number; hidden: boolean };
	toggleFailed?: () => void;
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
	let teamCursor = 0;
	let closed = false;
	let lastKey = "";
	let timer: ReturnType<typeof setInterval> | undefined;
	const unsubscribe = deps.subscribe?.(() => sync());
	if (deps.poll) {
		timer = setInterval(() => sync(), POLL_MS);
		timer.unref?.();
	}

	function rows(): readonly (BoardRow | TeamRow)[] {
		return tab === "runs" ? deps.runs() : deps.team();
	}

	function current(): BoardRow | TeamRow | undefined {
		return rows()[tab === "runs" ? runsCursor : teamCursor];
	}

	function data(): WorkspaceData {
		return {
			runs: deps.runs(),
			team: deps.team(),
			teamEnabled: deps.teamEnabled(),
			summary: deps.summary(),
		};
	}

	function keyOf(): string {
		const all = data();
		const failed = deps.failed?.();
		return [
			tab,
			runsCursor,
			teamCursor,
			all.teamEnabled,
			`${failed?.total ?? 0}:${failed?.hidden ? 1 : 0}`,
			all.runs
				.map((row) => `${row.taskId}:${row.section}:${row.turns}:${row.elapsedSec}`)
				.join("|"),
			all.team
				.map(
					(row) =>
						`${row.view.task.id}:${row.view.task.revision}:${row.view.task.status}:${row.live ? 1 : 0}`,
				)
				.join("|"),
		].join("|");
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
		else teamCursor = Math.max(0, Math.min(teamCursor + delta, list.length - 1));
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
		if (!row) return;
		if (matchesKey(key, Key.enter) && row.openable)
			return emit({ kind: "open", taskId: row.taskId });
		if (key === "s" && row.steerable) return emit({ kind: "steer", taskId: row.taskId });
		if (key === "x" && row.stoppable) return emit({ kind: "stop", taskId: row.taskId });
		if (key === "r" && row.retryable) return emit({ kind: "retry", taskId: row.taskId });
		if (key === "c") return emit({ kind: "copy", taskId: row.taskId });
	}

	function handleTeam(key: string): void {
		const row = current() as TeamRow | undefined;
		const taskId = row?.view.task.id;
		if (key === "g") {
			teamCursor = 0;
			return sync();
		}
		if (key === "G") {
			teamCursor = Math.max(0, deps.team().length - 1);
			return sync();
		}
		if (key === "t") return emit({ kind: "team-toggle" });
		if (key === "n") return emit({ kind: "team-new" });
		if (key === "s") return emit({ kind: "team-start" });
		if (!taskId) return;
		if (matchesKey(key, Key.enter)) return emit({ kind: "team-detail", taskId });
		if (key === "e") return emit({ kind: "team-edit", taskId });
		if (key === "a") return emit({ kind: "team-assign", taskId });
		if (key === "c") return emit({ kind: "team-claim", taskId });
		if (key === "r") return emit({ kind: "team-release", taskId });
		if (key === "x") return emit({ kind: "team-complete", taskId });
		if (key === "d") return emit({ kind: "team-delete", taskId });
	}

	return {
		render(width: number): string[] {
			const all = data();
			if (tab === "runs") runsCursor = Math.max(0, Math.min(runsCursor, all.runs.length - 1));
			else teamCursor = Math.max(0, Math.min(teamCursor, all.team.length - 1));
			lastKey = keyOf();
			return renderWorkspace({
				...all,
				tab,
				width,
				height: deps.height(),
				runsCursor,
				teamCursor,
				theme: deps.theme,
				activity: deps.activity,
				...(deps.failed ? { failed: deps.failed() } : {}),
			});
		},

		handleInput(key: string): void {
			if (closed) return;
			if (matchesKey(key, Key.escape) || key === "\x03") return emit({ kind: "close" });
			if (matchesKey(key, Key.tab)) {
				switchTab(tab === "runs" ? "team" : "runs");
				return;
			}
			if (key === "1") return switchTab("runs");
			if (key === "2") return switchTab("team");
			if (key === "f") return emit({ kind: "finish" });
			if (key === "e" && tab === "runs" && deps.failed?.().total) {
				deps.toggleFailed?.();
				runsCursor = Math.max(0, Math.min(runsCursor, deps.runs().length - 1));
				return;
			}
			if (matchesKey(key, Key.up) || key === "k") return move(-1);
			if (matchesKey(key, Key.down) || key === "j") return move(1);
			if (tab === "runs") handleRuns(key);
			else handleTeam(key);
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
