/**
 * Activity log tests: the pure summaries the detail menu renders.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	ActivityLog,
	activityLine,
	activityRows,
	describeToolCall,
} from "../src/telemetry/activity.ts";
import { DETAIL_CHARS, RECENT_LIMIT } from "../src/domain/activity-step.ts";

describe("describeToolCall", () => {
	it("names the argument that identifies the work", () => {
		assert.equal(
			describeToolCall("bash", { command: "go test ./internal/zen/" }),
			"go test ./internal/zen/",
		);
		assert.equal(describeToolCall("read", { path: "src/runner.ts" }), "src/runner.ts");
		assert.equal(describeToolCall("edit", { file_path: "src/menu.ts" }), "src/menu.ts");
		assert.equal(describeToolCall("write", { filePath: "a/b.ts" }), "a/b.ts");
		assert.equal(describeToolCall("grep", { pattern: "installTurnBudget" }), "installTurnBudget");
		assert.equal(describeToolCall("Task", { subagent_type: "worker" }), "→ worker");
	});

	it("collapses newlines so a command cannot break the row", () => {
		const row = describeToolCall("bash", { command: "line one\nline two\t\tthree" });
		assert.equal(row, "line one line two three");
	});

	it("cuts to the detail budget with an ellipsis", () => {
		const long = describeToolCall("bash", { command: "x".repeat(200) });
		assert.equal(long?.length, DETAIL_CHARS);
		assert.ok(long?.endsWith("…"));
	});

	it("says script for codemode and never pastes the body", () => {
		assert.equal(describeToolCall("codemode", { code: "const a = 1;" }), "script");
	});

	it("returns undefined rather than guessing", () => {
		// An unknown tool, missing args, and non-string args all yield no
		// detail: the row must not claim more than the event carried.
		assert.equal(describeToolCall("mystery", { path: "x" }), undefined);
		assert.equal(describeToolCall("read", undefined), undefined);
		assert.equal(describeToolCall("read", {}), undefined);
		assert.equal(describeToolCall("read", { path: 42 }), undefined);
		assert.equal(describeToolCall("read", { path: "   " }), undefined);
	});
});

describe("ActivityLog", () => {
	it("keeps the newest steps, oldest first, bounded by the limit", () => {
		const log = new ActivityLog();
		for (let i = 1; i <= RECENT_LIMIT + 2; i++)
			log.push("task-1", { tool: "bash", detail: `cmd${i}` });
		const kept = log.recent("task-1");
		assert.equal(kept.length, RECENT_LIMIT);
		assert.deepEqual(
			kept.map((s) => s.detail),
			["cmd3", "cmd4", "cmd5"],
			"the tail survives, in run order",
		);
	});

	it("keys are independent and drop on finish", () => {
		const log = new ActivityLog();
		log.push("a", { tool: "read", detail: "x.ts" });
		log.push("b", { tool: "bash", detail: "ls" });
		assert.deepEqual(log.recent("a"), [{ tool: "read", detail: "x.ts" }]);
		assert.deepEqual(log.recent("b"), [{ tool: "bash", detail: "ls" }]);
		log.drop("a");
		assert.deepEqual(log.recent("a"), [], "a finished run keeps no rows");
		assert.equal(log.recent("b").length, 1, "dropping one key leaves the other");
	});

	it("an unknown key has no rows", () => {
		assert.deepEqual(new ActivityLog().recent("never-seen"), []);
	});
});

describe("activity rows", () => {
	it("renders tool and detail on one line, tool alone when there is none", () => {
		assert.equal(activityLine({ tool: "bash", detail: "go build" }), "bash · go build");
		assert.equal(activityLine({ tool: "codemode", detail: "script" }), "codemode · script");
		assert.equal(activityLine({ tool: "Task" }), "Task");
	});

	it("gives at most three rows and no rows for an empty log", () => {
		const many = Array.from({ length: 6 }, (_, i) => ({ tool: "bash", detail: `c${i}` }));
		assert.equal(activityRows(many).length, RECENT_LIMIT);
		assert.deepEqual(activityRows(many), ["bash · c3", "bash · c4", "bash · c5"]);
		assert.deepEqual(activityRows([]), [], "no heading without rows under it");
	});
});
