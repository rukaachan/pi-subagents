import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boardHeight, renderBoard } from "../src/ui/view/board/index.ts";
import { board, plainTheme, rec } from "./board-fixtures.ts";

describe("board team strip", () => {
	it("adds the open-task count to the title without taking a row", () => {
		const rows = board([rec({ taskId: "r", startedAt: 1_000 })]);
		const height = boardHeight(rows);
		const out = renderBoard(rows, {
			width: 100,
			height,
			cursor: 0,
			team: { open: 2, done: 1, enabled: true },
			theme: plainTheme() as never,
		});
		assert.equal(out.length, height);
		assert.match(out[0] ?? "", /team 2 open/);
	});
});
