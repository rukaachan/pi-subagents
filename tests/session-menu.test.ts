/**
 * The run menu: "Open session" opens the viewer and comes back to the menu.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { showTaskDetail } from "../src/ui/menu/board/index.ts";
import type { TaskRecord } from "../src/domain/task/index.ts";
import type { TaskStore } from "../src/domain/task/index.ts";
import type { SubagentConfig } from "../src/domain/subagent/index.ts";

const ESC = "\x1b";
const ENTER = "\r";
const stubTheme = { fg: (_token: string, text: string) => text, bold: (text: string) => text };

initTheme("dark", false);

const SUB: SubagentConfig = {
	name: "worker",
	description: "Multi-step edits",
	model: "inherit",
	autonomy: "inherit",
	systemPrompt: "",
	source: "user",
	filePath: "",
	warnings: [],
};

function record(over: Partial<TaskRecord> = {}): TaskRecord {
	return {
		taskId: "t-abc123",
		subagentName: "worker",
		description: "map the rust engine",
		status: "running",
		createdAt: Date.now() - 4000,
		fullDelivered: false,
		subagent: SUB,
		cwd: "/tmp",
		history: [{ role: "user", content: "Task: map the rust engine" }],
		kind: "background",
		...over,
	};
}

interface Pending {
	comp: {
		render(width: number): string[];
		handleInput?(data: string): void;
	};
}

// Each custom() call waits for the test to drive its component, like a user would.
function harness() {
	const pending: Pending[] = [];
	const notices: string[] = [];
	const comps: Pending["comp"][] = [];
	const ui = {
		notify: (text: string) => notices.push(text),
		custom: <T>(factory: unknown): Promise<T> =>
			new Promise<T>((resolve) => {
				const make = factory as (...args: unknown[]) => unknown;
				const made = make(
					{ terminal: { rows: 24 }, requestRender: () => {} },
					stubTheme,
					null,
					(value: T) => resolve(value),
				);
				void Promise.resolve(made).then((comp) => {
					const component = comp as Pending["comp"];
					comps.push(component);
					pending.push({ comp: component });
				});
			}),
		select: async (): Promise<string | undefined> => undefined,
	};
	return { ui, pending, notices, comps };
}

const settle = () =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});

async function next(h: ReturnType<typeof harness>, keys: string): Promise<string> {
	await settle();
	const last = h.pending.at(-1);
	assert.ok(last, `no dialog open after ${h.comps.length} calls`);
	const frame = last.comp.render(80).join("\n");
	for (const key of keys) last.comp.handleInput?.(key);
	return frame;
}

describe("the run menu", () => {
	it("opens a live run's session and returns to the same menu", async () => {
		const h = harness();
		const rec = record();
		const run = showTaskDetail(
			{ ui: h.ui, mode: "tui" } as never,
			{} as TaskStore,
			rec,
			{} as never,
		);

		const menu = await next(h, ENTER);
		assert.match(menu, /Open session/);
		assert.match(menu, /Copy task_id/);

		const viewer = await next(h, "");
		assert.match(viewer, /transcript/);
		assert.match(viewer, /Task: map the rust engine/);
		assert.match(viewer, /esc back/);

		await next(h, ESC);
		const back = await next(h, ESC);
		assert.match(back, /Open session/, "the same menu, still offering the session");
		await run;
		assert.equal(h.comps.length, 3, "menu, viewer, menu again");
	});

	it("offers the saved transcript on a finished run", async () => {
		const h = harness();
		const rec = record({ status: "done" });
		const run = showTaskDetail(
			{ ui: h.ui, mode: "tui" } as never,
			{} as TaskStore,
			rec,
			{} as never,
		);
		const menu = await next(h, ESC);
		assert.match(menu, /Open session/);
		assert.match(menu, /Resume with follow-up/);
		await run;
		assert.equal(h.comps.length, 1);
	});

	it("leaves a finished chain alone, since steps are separate runs", async () => {
		const h = harness();
		const rec = record({ kind: "chain", status: "done", steps: [] });
		const run = showTaskDetail(
			{ ui: h.ui, mode: "tui" } as never,
			{} as TaskStore,
			rec,
			{} as never,
		);
		const menu = await next(h, ESC);
		assert.doesNotMatch(menu, /Open session/);
		assert.match(menu, /Copy task_id/);
		await run;
	});

	it("hides the viewer when a finished run kept no history", async () => {
		const h = harness();
		const rec = record({ status: "done", history: [] });
		const run = showTaskDetail(
			{ ui: h.ui, mode: "tui" } as never,
			{} as TaskStore,
			rec,
			{} as never,
		);
		const menu = await next(h, ESC);
		assert.doesNotMatch(menu, /Open session/);
		await run;
	});
});
