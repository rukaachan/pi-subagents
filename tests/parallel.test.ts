import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_LIVE_TASKS, newRecord } from "../src/app/task-record.ts";
import { TaskStore } from "../src/app/task-store.ts";
import { kindBadge } from "../src/ui/view/format.ts";
import { parallelStrip } from "../src/ui/view/rows.ts";
import { taskDetail } from "../src/ui/view/detail.ts";
import { taskRowItems } from "../src/ui/menu/items.ts";
import type { ParallelLeg } from "../src/app/task-record.ts";
import type { SubagentConfig } from "../src/domain/subagent/config.ts";

const sub: SubagentConfig = {
	name: "explorer",
	description: "map",
	model: "inherit",
	autonomy: "low",
	systemPrompt: "p",
	source: "user",
	filePath: "/x",
	warnings: [],
};

const leg = (idx: number, name: string, status: ParallelLeg["status"]): ParallelLeg => ({
	idx,
	subagentName: name,
	prompt: "p",
	status,
});

describe("parallel fan-out records", () => {
	it("keeps the parallel kind on the record", () => {
		const rec = newRecord(sub, "label", "/cwd", "parallel");
		assert.equal(rec.kind, "parallel");
	});

	it("badges parallel rows distinctly from background and chain", () => {
		assert.equal(kindBadge("parallel"), "⇉ par");
		assert.equal(kindBadge("chain"), "⛓ chain");
		assert.equal(kindBadge("background"), "○ bg");
	});

	it("strips legs with per-leg status glyphs", () => {
		const rec = newRecord(sub, "label", "/cwd", "parallel");
		rec.legs = [leg(0, "explorer", "done"), leg(1, "tester", "running"), leg(2, "worker", "error")];
		assert.equal(parallelStrip(rec), "explorer ✓ ⇉ tester … ⇉ worker ✗");
	});

	it("falls back to the single name when legs are missing", () => {
		const rec = newRecord(sub, "label", "/cwd", "parallel");
		assert.equal(parallelStrip(rec), "explorer");
	});

	it("shows legs in the detail table", () => {
		const rec = newRecord(sub, "label", "/cwd", "parallel");
		rec.legs = [leg(0, "explorer", "done"), leg(1, "worker", "done")];
		const detail = taskDetail(rec);
		assert.match(detail, /legs/);
		assert.match(detail, /explorer ✓ ⇉ worker ✓/);
	});

	it("renders one picker row per leg record, same as bg rows", () => {
		const store = new TaskStore();
		for (let i = 0; i < 3; i++) store.add(newRecord(sub, `leg ${i}`, "/cwd", "parallel"));
		const rows = taskRowItems(store.list());
		assert.ok(rows.length > 0);
		assert.equal(rows.length, 3);
		for (const row of rows) {
			const desc = row.description ?? "";
			assert.match(desc, /⇉ par/);
		}
	});

	it("admits legs until the live cap, refuses past it — never drops", () => {
		const store = new TaskStore();
		let admitted = 0;
		for (let i = 0; i < MAX_LIVE_TASKS + 4; i++) {
			if (!store.canStart()) break;
			store.add(newRecord(sub, `leg ${i}`, "/cwd", "parallel"));
			admitted++;
		}
		assert.equal(admitted, MAX_LIVE_TASKS);
		assert.ok(admitted < MAX_LIVE_TASKS + 4, "the cap actually refused legs");
		assert.equal(store.canStart(), false);
		const first = store.list()[0];
		if (first) {
			first.status = "done";
			store.touch();
		}
		assert.ok(first !== undefined, "cap test seeded at least one row");
		assert.equal(store.canStart(), true);
	});
});
