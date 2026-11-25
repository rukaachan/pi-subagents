/**
 * The selected-run pane: live steps, waiting states, and pinned keys.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { detailLines } from "../src/ui/view/board/index.ts";
import { board, plainTheme, rec } from "./board-fixtures.ts";

const theme = plainTheme();
const WIDTH = 43;

function row(over: Parameters<typeof rec>[0] = {}, live = true) {
	const first = board(
		[rec({ taskId: "task-1", startedAt: 1_000, ...over })],
		live ? ["task-1"] : [],
	)[0];
	assert.ok(first);
	return first;
}

describe("the selected-run pane", () => {
	it("shows the newest three steps under now", () => {
		const lines = detailLines(row(), WIDTH, theme, {
			steps: ["read · a.ts", "bash · b", "bash · c", "bash · d"],
		});
		const text = lines.join("\n");
		assert.match(text, /now/);
		assert.doesNotMatch(text, /read · a\.ts/);
		assert.match(text, /bash · b/);
		assert.match(text, /bash · d/);
	});

	it("pins the action keys to the last body row", () => {
		const lines = detailLines(row(), WIDTH, theme, { height: 14 });
		assert.equal(lines.length, 14);
		assert.match(lines.at(-1) ?? "", /enter open · s steer · x stop · c copy/);
	});

	it("waits for a first step when there is no activity", () => {
		const running = detailLines(row(), WIDTH, theme, { steps: [] });
		assert.match(running.join("\n"), /waiting for the first step/);
		const queued = detailLines(row({ startedAt: undefined }), WIDTH, theme, { steps: [] });
		assert.match(queued.join("\n"), /waiting for a slot/);
	});

	it("never writes past the pane width", () => {
		const lines = detailLines(row(), WIDTH, theme, {
			steps: ["bash · a-very-long-command-that-would-wrap-the-pane"],
			height: 14,
		});
		for (const line of lines) assert.ok(visibleWidth(line) <= WIDTH, line);
	});
});
