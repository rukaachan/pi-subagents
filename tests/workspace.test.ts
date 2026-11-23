/**
 * Mission control: Runs and Team tabs in one surface.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { TeamTaskView } from "../src/domain/team.ts";
import { board, plainTheme, rec } from "./board-fixtures.ts";
import { buildTeamRows, renderTeamScreen } from "../src/ui/view/team-screen.ts";
import { createWorkspaceView } from "../src/ui/view/workspace-view.ts";
import {
	renderWorkspace,
	workspaceHeight,
	type WorkspaceAction,
	type WorkspaceData,
} from "../src/ui/view/workspace-screen.ts";

function teamView(over: Partial<TeamTaskView["task"]> = {}): TeamTaskView {
	return {
		task: {
			id: "task-1",
			revision: 1,
			subject: "map the engine",
			description: "find the hot path",
			status: "pending",
			blockedBy: [],
			writeScopes: ["src"],
			createdAt: 1,
			updatedAt: 1,
			...over,
		},
		ready: true,
		blockedByOpen: [],
		writeScopeWarnings: [],
	};
}

function data(over: Partial<WorkspaceData> = {}): WorkspaceData {
	return {
		runs: [],
		team: [],
		teamEnabled: false,
		summary: { open: 0, done: 0, enabled: false },
		...over,
	};
}

function view(initial: WorkspaceData, tab: "runs" | "team" = "runs") {
	const actions: WorkspaceAction[] = [];
	const v = createWorkspaceView({
		tab,
		runs: () => initial.runs,
		team: () => initial.team,
		teamEnabled: () => initial.teamEnabled,
		summary: () => initial.summary,
		height: () => 14,
		theme: plainTheme() as never,
		render: () => {},
		onAction: (action) => actions.push(action),
	});
	return { v, actions };
}

describe("mission control", () => {
	it("opens with no runs and shows both tabs", () => {
		const empty = data();
		const out = renderWorkspace({
			...empty,
			tab: "runs",
			width: 90,
			height: 12,
			runsCursor: 0,
			teamCursor: 0,
			theme: plainTheme() as never,
		});
		assert.equal(out.length, 12);
		assert.ok(out.some((line) => line.includes("RUNS")));
		assert.ok(out.some((line) => line.includes("TEAM")));
		for (const line of out) assert.ok(visibleWidth(line) <= 90);
		assert.equal(workspaceHeight("runs", empty), 5);
	});

	it("switches to Team and emits every Team action", () => {
		const teamRows = buildTeamRows([teamView()], () => false);
		const row = teamRows[0];
		if (!row) throw new Error("missing team row");
		const initial = data({ team: [row], teamEnabled: true });
		const made = view(initial);
		made.v.render(90);
		made.v.handleInput("2");
		made.v.handleInput("n");
		assert.deepEqual(made.actions, [{ kind: "team-new" }]);
		assert.equal(
			made.v.render(90).some((line) => line.includes("map the engine")),
			true,
		);

		const keys: [string, WorkspaceAction["kind"]][] = [
			["\r", "team-detail"],
			["e", "team-edit"],
			["a", "team-assign"],
			["c", "team-claim"],
			["r", "team-release"],
			["x", "team-complete"],
			["d", "team-delete"],
		];
		for (const [key, kind] of keys) {
			const next = view(initial, "team");
			next.v.render(90);
			next.v.handleInput(key);
			assert.equal(next.actions[0]?.kind, kind, key);
		}
		const toggle = view(initial, "team");
		toggle.v.handleInput("t");
		assert.deepEqual(toggle.actions, [{ kind: "team-toggle" }]);
		const start = view(initial, "team");
		start.v.handleInput("s");
		assert.deepEqual(start.actions, [{ kind: "team-start" }]);
	});

	it("shows the team board in the Team tab with revision and owner", () => {
		const rows = buildTeamRows(
			[
				teamView({ status: "in_progress", owner: "alice", revision: 3 }),
				teamView({ id: "task-2", subject: "write the proof", status: "completed" }),
			],
			(name) => name === "alice",
		);
		const out = renderTeamScreen(rows, {
			width: 100,
			height: 12,
			cursor: 0,
			theme: plainTheme() as never,
			enabled: true,
		});
		assert.equal(out.length, 12);
		assert.ok(out.some((line) => line.includes("task-1")));
		assert.ok(out.some((line) => line.includes("alice")));
		assert.ok(out.some((line) => line.includes("rev 3")));
		assert.ok(out.some((line) => line.includes("live")));
	});

	it("keeps the Runs tab working with a row", () => {
		const runs = board([rec({ taskId: "task-1", startedAt: 1_000 })], ["task-1"]);
		const made = view(data({ runs }), "runs");
		made.v.render(90);
		made.v.handleInput("\r");
		assert.equal(made.actions[0]?.kind, "open");
		const finish = view(data({ runs }), "runs");
		finish.v.handleInput("f");
		assert.deepEqual(finish.actions, [{ kind: "finish" }]);
	});
});
