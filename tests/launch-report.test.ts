import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	renderLegFull,
	renderLegLine,
	renderRecordsReport,
	renderRunReport,
} from "../src/ui/view/launch-report.ts";
import { syncLegFailures, type LaunchLeg, type LaunchRun } from "../src/app/launch.ts";
import { newRecord } from "../src/app/task-record.ts";
import type { SubagentConfig } from "../src/domain/subagent/config.ts";

function leg(over: Partial<LaunchLeg> = {}): LaunchLeg {
	return {
		name: "explorer",
		status: "done",
		taskId: "task-abc123",
		startedAt: 0,
		endedAt: 8000,
		report: "SECRET-BODY",
		usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 2 },
		model: "test/model",
		...over,
	};
}

function run(legs: LaunchLeg[]): LaunchRun {
	return { kind: "delegate", label: "audit", runId: "run-test", startedAt: 0, legs };
}

describe("launch report rendering", () => {
	it("compact shows one line per leg and hides the bodies", () => {
		const text = renderRunReport(run([leg(), leg({ name: "tester" })]), { mode: "compact" });
		assert.match(text, /Delegate · audit · 2 legs · 2 done/);
		assert.match(text, /explorer · abc123 · DONE · 8s · 2t 150tok/);
		assert.doesNotMatch(text, /SECRET-BODY/);
		assert.doesNotMatch(text, /Full report/, "no hint line under the rows");
		assert.match(text.trimEnd().split("\n").at(-1) ?? "", /✓ tester · .* · DONE ·/);
	});

	it("shows the failure family on a failed leg", () => {
		const text = renderLegLine(
			leg({ status: "error", error: "boom", report: undefined, failure: "spec" }),
		);
		assert.match(text, /ERROR · \[spec\]/);
		assert.match(text, /boom/);
	});

	it("late labels reach the run legs before a report", () => {
		const current = run([leg({ status: "error", error: "boom", report: undefined })]);
		const rec = newRecord({ name: "explorer" } as SubagentConfig, "audit", "/tmp", "parallel");
		rec.taskId = "task-abc123";
		rec.status = "error";
		rec.failure = "spec";
		syncLegFailures(current, (id) => (id === "task-abc123" ? rec : undefined));
		assert.match(renderRunReport(current, { mode: "compact" }), /ERROR · \[spec\]/);
	});

	it("full drills into one leg by name and by short id", () => {
		const byName = renderRunReport(run([leg()]), { mode: "full", target: "explorer" });
		assert.match(byName, /SECRET-BODY/);
		const byId = renderRunReport(run([leg()]), { mode: "full", target: "abc123" });
		assert.match(byId, /SECRET-BODY/);
	});

	it("full names the roster when the target is missing", () => {
		const text = renderRunReport(run([leg()]), { mode: "full", target: "ghost" });
		assert.match(text, /No leg "ghost"/);
		assert.match(text, /Legs: explorer/);
	});

	it("status keeps only live legs", () => {
		const text = renderRunReport(
			run([leg(), leg({ name: "tester", status: "running", report: undefined })]),
			{ mode: "status" },
		);
		assert.match(text, /tester/);
		assert.doesNotMatch(text, /explorer/);
		const empty = renderRunReport(run([leg()]), { mode: "status" });
		assert.match(empty, /Nothing live/);
	});

	it("caps a huge run instead of one giant notify", () => {
		const legs = Array.from({ length: 250 }, (_, i) => leg({ name: `leg-${i}` }));
		const text = renderRunReport(run(legs), { mode: "compact" });
		assert.match(text, /… and 50 more/);
		assert.equal(text.split("\n").filter((line) => line.includes(" · DONE · ")).length, 200);
	});

	it("keeps errors and stopped legs visible in the compact view", () => {
		const line = renderLegLine(leg({ status: "error", error: "boom\non two lines" }));
		assert.match(line, /ERROR · 8s · .* — boom on two lines/);
		const stopped = renderLegLine(leg({ status: "stopped" }));
		assert.match(stopped, /STOPPED/);
		const queued = renderLegLine(
			leg({ status: "queued", startedAt: undefined, endedAt: undefined }),
		);
		assert.match(queued, /QUEUED · waiting/);
	});

	it("leg full omits the body for a non-done leg", () => {
		const text = renderLegFull(leg({ status: "error", error: "boom" }));
		assert.doesNotMatch(text, /SECRET-BODY/);
		assert.match(text, /boom/);
	});
});

describe("parallel-run fallback rendering", () => {
	const sub: SubagentConfig = {
		name: "explorer",
		description: "",
		model: "inherit",
		autonomy: "low",
		systemPrompt: "p",
		source: "user",
		filePath: "f",
		warnings: [],
	};
	const done = newRecord(sub, "audit", "/tmp", "parallel");
	done.status = "done";
	done.result = {
		text: "SECRET-BODY",
		usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
		notes: [],
	};
	const failed = newRecord(sub, "audit", "/tmp", "parallel");
	failed.status = "error";
	failed.error = "boom";
	const records = [failed, done];

	it("compact hides bodies and marks failures", () => {
		const text = renderRecordsReport(records, "delegate", { mode: "compact" });
		assert.doesNotMatch(text, /SECRET-BODY/);
		assert.match(text, /boom/);
		assert.match(text, /No delegate this session/);
	});

	it("full drills into a record", () => {
		const text = renderRecordsReport(records, "delegate", { mode: "full", target: "explorer" });
		assert.match(text, /SECRET-BODY/);
	});

	it("says how to start when there are no runs", () => {
		assert.match(renderRecordsReport([], "delegate", { mode: "compact" }), /\/delegate <prompt>/);
	});
});
