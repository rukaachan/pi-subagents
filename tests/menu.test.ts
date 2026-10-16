/**
 * The run detail body and the menu helpers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { ROUTE, isRoute } from "../src/ui/menu/constants.ts";
import { subagentRowItems, taskRowItems, trashRowItems } from "../src/ui/menu/items.ts";
import { modelRow, stepTitle, trashBase, trashRow } from "../src/ui/view/format.ts";
import { recentSteps, sortTaskRows } from "../src/ui/menu/task-list.ts";
import { footerProgress } from "../src/telemetry/progress.ts";
import type { TaskRecord } from "../src/app/task-record.ts";
import type { SubagentConfig } from "../src/domain/subagent/config.ts";

const taskRec = (over: Partial<TaskRecord>): TaskRecord =>
	({
		taskId: "t",
		subagentName: "w",
		description: "d",
		status: "done",
		createdAt: 1,
		fullDelivered: false,
		...over,
	}) as TaskRecord;
describe("recentSteps (run detail body)", () => {
	// The real tracker, driven through its own API: this is the module
	// the menu reads, not a stand-in for it.

	it("answers with the live tail for a running single run", () => {
		const key = "task-live-body";
		footerProgress.start(key, "worker");
		try {
			footerProgress.step(key, { tool: "bash", detail: "go build ./..." });
			footerProgress.step(key, { tool: "read", detail: "src/runner.ts" });
			footerProgress.step(key, { tool: "edit", detail: "src/subagents.ts" });
			assert.deepEqual(recentSteps(taskRec({ taskId: key, status: "running" })), [
				"bash · go build ./...",
				"read · src/runner.ts",
				"edit · src/subagents.ts",
			]);
		} finally {
			footerProgress.finish(key);
		}
	});

	it("drops the rows when the run finishes, so nothing stale is shown", () => {
		const key = "task-live-dropped";
		footerProgress.start(key, "worker");
		footerProgress.step(key, { tool: "bash", detail: "ls" });
		footerProgress.finish(key);
		assert.equal(recentSteps(taskRec({ taskId: key, status: "done" })), undefined);
	});

	it("reports each running leg of a parallel group, named", () => {
		const parent = "task-group-body";
		const legA = "task-group-body-a";
		const legB = "task-group-body-b";
		footerProgress.start(legA, "worker");
		footerProgress.start(legB, "explorer");
		try {
			footerProgress.step(legA, { tool: "bash", detail: "go test ./..." });
			footerProgress.step(legB, { tool: "grep", detail: "installTurnBudget" });
			const rows = recentSteps(
				taskRec({
					taskId: parent,
					kind: "parallel",
					status: "running",
					legs: [
						{ idx: 0, subagentName: "worker", prompt: "p", status: "running", taskId: legA },
						{ idx: 1, subagentName: "explorer", prompt: "p", status: "running", taskId: legB },
					],
				}),
			);
			assert.deepEqual(rows, [
				"worker#1 · bash · go test ./...",
				"explorer#2 · grep · installTurnBudget",
			]);
		} finally {
			footerProgress.finish(legA);
			footerProgress.finish(legB);
		}
	});

	it("a group with no running leg shows no rows", () => {
		assert.equal(
			recentSteps(
				taskRec({
					taskId: "task-group-done",
					kind: "parallel",
					status: "done",
					legs: [{ idx: 0, subagentName: "worker", prompt: "p", status: "done", taskId: "gone" }],
				}),
			),
			undefined,
		);
	});
});
describe("menu helpers", () => {
	it("returns one row per subagent file, with no route rows", () => {
		// A dead row is one the caller cannot handle: it renders and
		// highlights, then does nothing on enter. The file list must
		// therefore contain exactly the subagent names as values.
		const subs = [
			{ name: "tasks", source: "user", model: "inherit", tools: undefined, description: "mine" },
			{ name: "trash", source: "user", model: "inherit", tools: undefined, description: "mine" },
			{ name: "explorer", source: "user", model: "inherit", tools: undefined, description: "x" },
		] as SubagentConfig[];
		const items = subagentRowItems(subs);
		assert.equal(items.length, subs.length, "one row per file, nothing appended");
		assert.deepEqual(
			items.map((i) => i.value),
			["tasks", "trash", "explorer"],
			"values are the subagent names, in file order",
		);
		for (const item of items) {
			assert.equal(isRoute(item.value), false, `${item.label} must not be a route row`);
		}
	});

	it("keeps every picker value resolvable by its caller", () => {
		// The guard for dead rows.
		const subs = [
			{ name: "tasks", source: "user", model: "inherit", tools: undefined, description: "m" },
			{ name: "explorer", source: "user", model: "inherit", tools: undefined, description: "x" },
		] as SubagentConfig[];
		for (const item of subagentRowItems(subs)) {
			const hit = subs.find((s) => s.name === item.value);
			assert.ok(hit, `file row "${item.label}" is a dead row: no subagent named ${item.value}`);
		}

		const rec = {
			taskId: "task-abc123-1",
			subagentName: "explorer",
			description: "d",
			status: "running",
			createdAt: 1,
			kind: "background",
		} as unknown as TaskRecord;
		const taskRows = taskRowItems([rec]);
		for (const item of taskRows) {
			assert.ok(
				[rec].find((t) => t.taskId === item.value),
				`task row "${item.label}" is a dead row`,
			);
		}

		const trash = [{ base: "old-2026.md", fileName: "old.md", stamp: "2026" }];
		for (const item of trashRowItems(trash)) {
			assert.ok(
				trash.find((t) => t.base === item.value),
				`trash row "${item.label}" is a dead row`,
			);
		}
	});

	it("routes by sentinel value, not row text", () => {
		assert.equal(isRoute(ROUTE.cancel), true);
		assert.equal(isRoute("tasks"), false, "a subagent named tasks is a plain name");
		assert.equal(isRoute("explorer"), false);
	});

	it("builds step titles and model rows", () => {
		assert.equal(stepTitle(2, 5, "Name"), "●●○○○ Name (2/5)");
		assert.equal(modelRow("acme", "fast-1"), "acme/fast-1");
	});

	it("numbers every wizard step against one total", () => {
		const src = fs.readFileSync(
			path.join(import.meta.dirname, "..", "src", "ui", "menu", "wizard.ts"),
			"utf8",
		);
		const total = Number(src.match(/const TOTAL = (\d+);/)?.[1]);
		const steps = [...src.matchAll(/stepTitle\((\d+), TOTAL,/g)].map((m) => Number(m[1]));
		assert.equal(total, steps.length, `TOTAL ${total} must equal the ${steps.length} steps`);
		assert.deepEqual(
			steps,
			Array.from({ length: steps.length }, (_, i) => i + 1),
			"steps run 1..TOTAL with no gap",
		);
	});

	it("sorts live runs first", () => {
		const rows = sortTaskRows([
			taskRec({ taskId: "old-done", createdAt: 1 }),
			taskRec({ taskId: "live", status: "running", createdAt: 2 }),
			taskRec({ taskId: "new-done", createdAt: 3 }),
		]);
		assert.deepEqual(
			rows.map((r) => r.taskId),
			["live", "new-done", "old-done"],
		);
	});

	it("builds and parses trash rows", () => {
		const row = trashRow({ fileName: "w-1.md", trashPath: "/t/w-1.md", base: "w", stamp: "today" });
		assert.equal(row, "w · today");
		assert.equal(trashBase(row), "w");
	});
});
