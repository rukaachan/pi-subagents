/**
 * The board screen: cards, keys, and repaint discipline.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	boardHeight,
	createBoardView,
	renderBoard,
	type BoardAction,
} from "../src/ui/view/board/index.ts";
import { board, plainTheme, rec } from "./board-fixtures.ts";

const ESC = "\x1b";
const ENTER = "\r";

function view(rows: () => ReturnType<typeof board>, over: Record<string, unknown> = {}) {
	const actions: BoardAction[] = [];
	let pings = 0;
	const v = createBoardView({
		rows,
		height: () => 14,
		theme: plainTheme() as never,
		render: () => {
			pings += 1;
		},
		onAction: (a) => actions.push(a),
		...over,
	});
	return { v, actions, pings: () => pings };
}

function cardAt(out: string[]): string {
	const selected = out.findIndex((line) => line.includes("›"));
	return selected < 0 ? "" : out.slice(selected, selected + 3).join("\n");
}

describe("the board screen", () => {
	it("fills 80x24 and 120x40 exactly, with no line past the edge", () => {
		const rows = board(
			Array.from({ length: 12 }, (_, i) =>
				rec({
					taskId: "task-" + i,
					subagentName: "leg-" + i,
					startedAt: 1_000,
					runId: "run-parallel-abc",
				}),
			),
			["task-0"],
		);
		for (const [width, height] of [
			[80, 24],
			[100, 30],
			[120, 40],
		] as const) {
			const out = renderBoard(rows, { width, height, cursor: 3, theme: plainTheme() as never });
			assert.equal(out.length, height, "height at " + width);
			for (const line of out) assert.ok(visibleWidth(line) <= width, "wide: " + line);
			assert.match(out[0] ?? "", /pi-subagents/);
			assert.ok(out.some((line) => line.includes("RUNNING")));
			assert.ok(out.some((line) => line.includes("╭")));
			assert.ok(out.some((line) => line.includes("›")));
		}
	});

	it("uses only the height it needs", () => {
		const rows = board([
			rec({ taskId: "r", startedAt: 1_000 }),
			rec({ taskId: "d", status: "done", startedAt: 1_000, endedAt: 2_000 }),
		]);
		const height = boardHeight(rows);
		assert.equal(height, 15);
		const out = renderBoard(rows, { width: 100, height, cursor: 0, theme: plainTheme() as never });
		assert.equal(out.length, height);
		assert.ok((out[3] ?? "").trim().length > 0, "first card starts after the header");
		assert.ok((out.at(-2) ?? "").trim().length > 0, "last card sits above the hint");
	});

	it("puts the duration at the right edge and the metrics under the name", () => {
		const rows = board([
			rec({
				taskId: "a",
				description: "review the auth diff",
				startedAt: 1_000,
				result: {
					text: "",
					usage: { turns: 2, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
					notes: [],
				},
			}),
		]);
		const out = renderBoard(rows, {
			width: 80,
			height: 12,
			cursor: 0,
			theme: plainTheme() as never,
		});
		const title = out.find((line) => line.includes("worker"));
		assert.ok(title, "card title rendered");
		assert.match(title ?? "", /9s\s+│$/);
		assert.equal(visibleWidth(title ?? ""), 78);
		assert.ok(out.some((line) => line.includes("review the auth diff")));
		assert.ok(out.some((line) => line.includes("2t")));
	});

	it("draws a rounded card and marks the selected one", () => {
		const rows = board([
			rec({
				taskId: "task-mwjcrux1-1",
				description: "review the auth diff",
				startedAt: 1_000,
			}),
		]);
		const out = renderBoard(rows, {
			width: 120,
			height: 12,
			cursor: 0,
			theme: plainTheme() as never,
		});
		assert.ok(out.some((line) => line.includes("╭")));
		assert.ok(out.some((line) => line.includes("╰")));
		assert.ok(out.some((line) => line.includes("›")));
		assert.ok(out.some((line) => line.includes("review the auth diff")));
		assert.equal(
			out.some((line) => line.includes("SELECTED")),
			false,
		);
		for (const line of out) assert.ok(visibleWidth(line) <= 120);
	});

	it("shows all four sections when the height allows it", () => {
		const rows = board([
			rec({ taskId: "q" }),
			rec({ taskId: "r", startedAt: 1_000 }),
			rec({ taskId: "d", status: "done", startedAt: 1_000, endedAt: 2_000 }),
			rec({ taskId: "f", status: "error", startedAt: 1_000, endedAt: 2_000 }),
		]);
		const all = renderBoard(rows, {
			width: 90,
			height: boardHeight(rows),
			cursor: 0,
			theme: plainTheme() as never,
		}).join("\n");
		for (const word of ["QUEUED", "RUNNING", "DONE", "FAILED"]) assert.match(all, new RegExp(word));
		assert.match(all, /2 running · 1 done · 1 failed/);
	});

	it("moves the cursor with j, k, g, and G", () => {
		const rows = [
			rec({ taskId: "a", description: "alpha", startedAt: 1_000 }),
			rec({ taskId: "b", description: "beta", startedAt: 1_000 }),
			rec({ taskId: "c", description: "gamma", startedAt: 1_000 }),
		];
		const { v } = view(() => board(rows));
		const selected = () => cardAt(v.render(80));
		assert.match(selected(), /alpha/);
		v.handleInput("j");
		assert.match(selected(), /beta/);
		v.handleInput("G");
		assert.match(selected(), /gamma/);
		v.handleInput("g");
		assert.match(selected(), /alpha/);
		v.handleInput("k");
		assert.match(selected(), /alpha/);
	});

	it("shows what the run is doing, not its random task key", () => {
		const out = renderBoard(
			board([
				rec({
					taskId: "task-mwjcrux1-1",
					description: "review the auth diff for findings",
					startedAt: 1_000,
				}),
			]),
			{ width: 100, height: 24, cursor: 0, theme: plainTheme() as never },
		).join("\n");
		assert.match(out, /review the auth diff for findings/);
		assert.doesNotMatch(out, /cur5d5/);
	});

	it("opens a normal leg and refuses a chain row", () => {
		const rows = [
			rec({ taskId: "a", startedAt: 1_000 }),
			rec({ taskId: "b", kind: "chain", startedAt: 1_000 }),
		];
		const { v, actions } = view(() => board(rows));
		v.handleInput(ENTER);
		assert.deepEqual(actions, [{ kind: "open", taskId: "a" }]);
		const chainOnly = view(() => board([rec({ taskId: "b", kind: "chain", startedAt: 1_000 })]));
		chainOnly.v.handleInput(ENTER);
		assert.equal(chainOnly.actions.length, 0);
	});

	it("steers and stops only a live leg, retries only a failed one", () => {
		const rows = board(
			[
				rec({ taskId: "live", startedAt: 1_000 }),
				rec({ taskId: "dead", status: "error", startedAt: 1_000, prompt: "go" }),
			],
			["live"],
		);
		const steer = view(() => rows);
		steer.v.handleInput("s");
		assert.deepEqual(steer.actions, [{ kind: "steer", taskId: "live" }]);
		const stop = view(() => rows);
		stop.v.handleInput("x");
		assert.deepEqual(stop.actions, [{ kind: "stop", taskId: "live" }]);
		const failed = view(() =>
			board([rec({ taskId: "dead", status: "error", startedAt: 1_000, prompt: "go" })]),
		);
		failed.v.handleInput("s");
		failed.v.handleInput("r");
		assert.deepEqual(failed.actions, [{ kind: "retry", taskId: "dead" }]);
	});

	it("copies the id and closes on escape", () => {
		const { v, actions } = view(() => board([rec({ taskId: "a", startedAt: 1_000 })]));
		v.handleInput("c");
		assert.deepEqual(actions, [{ kind: "copy", taskId: "a" }]);
		const closed = view(() => board([rec()]));
		closed.v.handleInput(ESC);
		assert.deepEqual(closed.actions, [{ kind: "close" }]);
	});

	it("repaints only when the rows or cursor change", () => {
		let rows = board([rec({ taskId: "a", startedAt: 1_000 })], [], 10_000);
		const { v, pings } = view(() => rows);
		v.render(80);
		const before = pings();
		v.sync();
		assert.equal(pings(), before);
		rows = board([rec({ taskId: "a", startedAt: 1_000 })], [], 11_000);
		v.sync();
		assert.ok(pings() > before, "elapsed changed, repaint");
	});

	it("goes quiet after dispose", () => {
		const { v, pings } = view(() => board([rec({ taskId: "a", startedAt: 1_000 })]), {
			poll: true,
			alive: () => true,
		});
		v.render(80);
		v.dispose();
		const before = pings();
		v.sync();
		assert.equal(pings(), before);
	});
});
