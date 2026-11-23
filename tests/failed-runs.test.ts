/**
 * Failed runs stay collapsed until someone asks for them.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { board, plainTheme, rec } from "./board-fixtures.ts";
import { createWorkspaceView } from "../src/ui/view/workspace-view.ts";
import {
	renderWorkspace,
	workspaceHeight,
	type WorkspaceData,
} from "../src/ui/view/workspace-screen.ts";

function empty(): WorkspaceData {
	return { runs: [], team: [], teamEnabled: false, summary: { open: 0, done: 0, enabled: false } };
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
			teamCursor: 0,
			theme: plainTheme() as never,
			failed: { total: 1, hidden: true },
		});
		assert.match(out[0] ?? "", /1 failed/);
		assert.match(out.at(-2) ?? "", /e show 1 failed/);
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
			teamCursor: 0,
			theme: plainTheme() as never,
			failed: { total: 1, hidden: false },
		});
		assert.match(open.at(-2) ?? "", /e hide failed/);
		assert.equal(
			open.some((line) => line.includes("✗")),
			true,
		);
	});

	it("toggles with e on the Runs tab", () => {
		let toggles = 0;
		const v = createWorkspaceView({
			tab: "runs",
			runs: () => [],
			team: () => [],
			teamEnabled: () => false,
			summary: () => ({ open: 0, done: 0, enabled: false }),
			height: () => 8,
			theme: plainTheme() as never,
			render: () => {},
			onAction: () => {},
			failed: () => ({ total: 1, hidden: true }),
			toggleFailed: () => {
				toggles += 1;
			},
		});
		v.handleInput("e");
		assert.equal(toggles, 1);
	});
});
