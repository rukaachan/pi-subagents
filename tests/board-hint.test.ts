/**
 * The board footer lists only what the selected row can do.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { boardHint } from "../src/ui/view/board/index.ts";
import { board, rec } from "./board-fixtures.ts";

function hint(row: ReturnType<typeof rec>, live = false): string {
	return boardHint(board([row], live ? [row.taskId] : []), 0);
}

describe("the board footer", () => {
	it("lists only the actions the selected row offers", () => {
		const running = hint(rec({ taskId: "a", startedAt: 1_000 }), true);
		assert.match(running, /s steer/);
		assert.match(running, /x stop/);
		assert.match(running, /f finish/);
		assert.doesNotMatch(running, /r retry/);

		const failed = hint(rec({ taskId: "b", status: "error", endedAt: 2_000, prompt: "retry me" }));
		assert.match(failed, /r retry/);
		assert.doesNotMatch(failed, /s steer/);

		const done = hint(rec({ taskId: "c", status: "done", endedAt: 2_000 }));
		assert.doesNotMatch(done, /steer|retry|stop/);
		assert.match(done, /n run/);
		assert.doesNotMatch(done, /\? help/);
		assert.ok(visibleWidth(done) < 80, done);
	});

	it("offers a first run with no rows", () => {
		const empty = boardHint([], 0);
		assert.match(empty, /enter run/);
		assert.doesNotMatch(empty, /\? help/);
		assert.match(empty, /0\/0$/);
	});

	it("offers the hidden toggle only while stopped or failed rows are known", () => {
		const three = { failed: 2, stopped: 1, hidden: true };
		assert.match(boardHint([], 0, three), /e show 3 hidden/);
		assert.match(boardHint([], 0, { ...three, hidden: false }), /e hide hidden/);
		assert.doesNotMatch(boardHint([], 0), /show .* hidden|hide hidden/);
	});
});
