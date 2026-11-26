/**
 * Mission control: Runs and Team tabs in one surface.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { AgentTeamTaskView } from "../src/domain/agent-team/index.ts";
import { board, plainTheme, rec } from "./board-fixtures.ts";
import { buildAgentTeamRows, renderAgentTeamScreen } from "../src/ui/view/workspace/index.ts";
import { createWorkspaceView } from "../src/ui/view/workspace/index.ts";
import {
	renderWorkspace,
	workspaceHeight,
	type WorkspaceAction,
	type WorkspaceData,
} from "../src/ui/view/workspace/index.ts";

function agentTeamView(over: Partial<AgentTeamTaskView["task"]> = {}): AgentTeamTaskView {
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

function agentTeamHint(status: "pending" | "in_progress" | "completed") {
	const rows = buildAgentTeamRows([agentTeamView({ status })], () => false);
	const out = renderAgentTeamScreen(rows, {
		width: 120,
		height: 12,
		cursor: 0,
		theme: plainTheme() as never,
		enabled: true,
	});
	return { footer: out.at(-2) ?? "", head: out[0] ?? "" };
}

function data(over: Partial<WorkspaceData> = {}): WorkspaceData {
	return {
		runs: [],
		agentTeam: [],
		agentTeamEnabled: false,
		summary: { open: 0, done: 0, enabled: false },
		...over,
	};
}

function view(initial: WorkspaceData, tab: "runs" | "agent-team" = "runs") {
	const actions: WorkspaceAction[] = [];
	const v = createWorkspaceView({
		tab,
		runs: () => initial.runs,
		agentTeam: () => initial.agentTeam,
		agentTeamEnabled: () => initial.agentTeamEnabled,
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
			agentTeamCursor: 0,
			theme: plainTheme() as never,
		});
		assert.equal(out.length, 12);
		assert.ok(out.some((line) => line.includes("RUNS")));
		assert.ok(out.some((line) => line.includes("TEAM")));
		for (const line of out) assert.ok(visibleWidth(line) <= 90);
		assert.equal(workspaceHeight("runs", empty), 6);
	});

	it("switches to Team and emits every Team action", () => {
		const agentTeamRows = buildAgentTeamRows([agentTeamView()], () => false);
		const row = agentTeamRows[0];
		if (!row) throw new Error("missing team row");
		const initial = data({ agentTeam: [row], agentTeamEnabled: true });
		const made = view(initial);
		made.v.render(90);
		made.v.handleInput("2");
		made.v.handleInput("n");
		assert.deepEqual(made.actions, [{ kind: "agent-team-new" }]);
		assert.equal(
			made.v.render(90).some((line) => line.includes("map the engine")),
			true,
		);

		const keys: [string, WorkspaceAction["kind"]][] = [
			["\r", "agent-team-detail"],
			["o", "agent-team-open-run"],
			["e", "agent-team-edit"],
			["a", "agent-team-assign"],
			["c", "agent-team-claim"],
			["r", "agent-team-release"],
			["x", "agent-team-complete"],
			["d", "agent-team-delete"],
		];
		for (const [key, kind] of keys) {
			const next = view(initial, "agent-team");
			next.v.render(90);
			next.v.handleInput(key);
			assert.equal(next.actions[0]?.kind, kind, key);
		}
		const toggle = view(initial, "agent-team");
		toggle.v.handleInput("t");
		assert.deepEqual(toggle.actions, [{ kind: "agent-team-toggle" }]);
		const start = view(initial, "agent-team");
		start.v.handleInput("s");
		assert.deepEqual(start.actions, [{ kind: "agent-team-start" }]);
	});

	it("shows the linked run and one result line in the detail pane", () => {
		const linked = buildAgentTeamRows(
			[
				agentTeamView({
					runId: "task-run-0",
					status: "completed",
					result: "changed src/a.ts; tests pass",
				}),
			],
			() => false,
		);
		const withRun = renderAgentTeamScreen(linked, {
			width: 120,
			height: 12,
			cursor: 0,
			theme: plainTheme() as never,
			enabled: true,
		}).join("\n");
		assert.match(withRun, /run task-run-0/);
		assert.match(withRun, /result: changed src\/a\.ts; tests pass/);
		assert.match(withRun, /o open run/);

		const plain = buildAgentTeamRows([agentTeamView({ status: "completed" })], () => false);
		const withoutRun = renderAgentTeamScreen(plain, {
			width: 120,
			height: 12,
			cursor: 0,
			theme: plainTheme() as never,
			enabled: true,
		}).join("\n");
		assert.match(withoutRun, /no run linked/);
		assert.doesNotMatch(withoutRun, /o open run/);
	});

	it("shows the team board in the Team tab with revision and owner", () => {
		const rows = buildAgentTeamRows(
			[
				agentTeamView({ status: "in_progress", owner: "alice", revision: 3 }),
				agentTeamView({ id: "task-2", subject: "write the proof", status: "completed" }),
			],
			(name) => name === "alice",
		);
		const out = renderAgentTeamScreen(rows, {
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

	it("lists the Team actions for the selected task status", () => {
		const pending = agentTeamHint("pending");
		assert.match(pending.footer, /c claim/);
		assert.doesNotMatch(pending.footer, /x done/);
		assert.match(pending.head, /team on \(t\)/);
		const active = agentTeamHint("in_progress");
		assert.match(active.footer, /x done/);
		assert.match(active.footer, /r release/);
		assert.doesNotMatch(active.footer, /c claim/);
		const done = agentTeamHint("completed");
		assert.doesNotMatch(done.footer, /claim|release|x done/);
		assert.match(done.footer, /e edit/);
		assert.ok(visibleWidth(done.footer) <= 120, done.footer);
	});

	it("feeds the selected run's steps to the pane", () => {
		const runs = board([rec({ taskId: "task-1", startedAt: 1_000 })], ["task-1"]);
		const seen: string[] = [];
		const out = renderWorkspace({
			runs,
			agentTeam: [],
			agentTeamEnabled: false,
			summary: { open: 0, done: 0, enabled: false },
			tab: "runs",
			width: 120,
			height: 18,
			runsCursor: 0,
			agentTeamCursor: 0,
			theme: plainTheme() as never,
			activity: (taskId) => {
				seen.push(taskId);
				return ["bash · rg -n store"];
			},
		});
		assert.deepEqual(seen, ["task-1"]);
		assert.ok(out.some((line) => line.includes("bash · rg -n store")));
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

	it("shows the first-use panel and the run footer", () => {
		const empty = data();
		const out = renderWorkspace({
			...empty,
			tab: "runs",
			width: 120,
			height: 12,
			runsCursor: 0,
			agentTeamCursor: 0,
			theme: plainTheme() as never,
		});
		const all = out.join("\n");
		assert.match(all, /No runs yet\./);
		assert.match(all, /Press enter to run something\./);
		assert.match(all, /\/subagents new to create a subagent\./);
		const footer = out.at(-2) ?? "";
		assert.match(footer, /enter run/);
		assert.match(footer, /\? help/);
		assert.match(footer, /f finish/);
		assert.match(footer, /0\/0/);
	});

	it("runs from an empty board with Enter or n", () => {
		for (const key of ["\r", "n"]) {
			const made = view(data(), "runs");
			made.v.handleInput(key);
			assert.deepEqual(made.actions, [{ kind: "finish" }], key);
		}
	});

	it("keeps n as run when rows exist and opens help with ?", () => {
		const runs = board([rec({ taskId: "task-1", startedAt: 1_000 })], ["task-1"]);
		const made = view(data({ runs }), "runs");
		made.v.handleInput("n");
		assert.deepEqual(made.actions, [{ kind: "finish" }]);
		const help = view(data({ runs }), "runs");
		help.v.handleInput("?");
		assert.deepEqual(help.actions, [{ kind: "help" }]);
		const teamHelp = view(data(), "agent-team");
		teamHelp.v.handleInput("?");
		assert.deepEqual(teamHelp.actions, [{ kind: "help" }]);
	});
});
