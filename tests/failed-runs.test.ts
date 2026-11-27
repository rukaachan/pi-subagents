/**
 * Failed runs stay collapsed until someone asks for them.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { board, plainTheme, rec } from "./board-fixtures.ts";
import { createWorkspaceView } from "../src/ui/view/workspace/index.ts";
import {
	renderWorkspace,
	workspaceHeight,
	type WorkspaceData,
} from "../src/ui/view/workspace/index.ts";

function empty(): WorkspaceData {
	return {
		runs: [],
		agentTeam: [],
		agentTeamEnabled: false,
		summary: { open: 0, done: 0, enabled: false },
	};
}

describe("failed runs", () => {
	it("collapse behind a count and a toggle", () => {
		const bad = board([rec({ taskId: "bad", status: "error", endedAt: 2_000 })])[0];
		assert.ok(bad);
		const out = renderWorkspace({
			...empty(),
			tab: "runs",
			width: 90,
			height: 8,
			runsCursor: 0,
			agentTeamCursor: 0,
			theme: plainTheme() as never,
			hidden: { failed: 1, stopped: 0, hidden: true },
		});
		assert.match(out[0] ?? "", /1 failed/);
		assert.ok(
			out.some((line) => line.includes("No visible runs")),
			out.join("\n"),
		);
		assert.match(out.at(-1) ?? "", /e show 1 hidden/);
		assert.equal(
			out.some((line) => line.includes("✗")),
			false,
		);

		const shown = { ...empty(), runs: [bad] };
		const open = renderWorkspace({
			...shown,
			tab: "runs",
			width: 90,
			height: workspaceHeight("runs", shown),
			runsCursor: 0,
			agentTeamCursor: 0,
			theme: plainTheme() as never,
			hidden: { failed: 1, stopped: 0, hidden: false },
		});
		assert.match(open.at(-1) ?? "", /e hide hidden/);
		assert.equal(
			open.some((line) => line.includes("✗")),
			true,
		);
	});

	it("hides stopped rows behind the same toggle", () => {
		const stopped = board([rec({ taskId: "stop", status: "stopped", endedAt: 2_000 })])[0];
		assert.ok(stopped);
		assert.equal(stopped.section, "stopped");
		const out = renderWorkspace({
			...empty(),
			tab: "runs",
			width: 90,
			height: 8,
			runsCursor: 0,
			agentTeamCursor: 0,
			theme: plainTheme() as never,
			hidden: { failed: 0, stopped: 1, hidden: true },
		});
		assert.match(out[0] ?? "", /1 stopped/);
		assert.match(out.at(-1) ?? "", /e show 1 hidden/);
		assert.equal(
			out.some((line) => line.includes("⊘")),
			false,
		);
	});

	it("toggles with e on the Runs tab", () => {
		let toggles = 0;
		const v = createWorkspaceView({
			tab: "runs",
			runs: () => [],
			agentTeam: () => [],
			agentTeamEnabled: () => false,
			summary: () => ({ open: 0, done: 0, enabled: false }),
			height: () => 8,
			theme: plainTheme() as never,
			render: () => {},
			onAction: () => {},
			hidden: () => ({ failed: 1, stopped: 0, hidden: true }),
			toggleHidden: () => {
				toggles += 1;
			},
		});
		v.handleInput("e");
		assert.equal(toggles, 1);
	});
});
