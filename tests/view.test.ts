import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	FIELD_CHOICES,
	subagentTemplate,
	templateFromStarter,
	validateField,
	writeSubagentFile,
} from "../src/infra/files.ts";
import { trashSubagentFile } from "../src/infra/trash.ts";
import {
	kindBadge,
	kvTable,
	rowName,
	rowTaskKey,
	shortKey,
	shortText,
	sourceBadge,
	toolsBadge,
	usageLine,
} from "../src/ui/view/format.ts";
import { subagentDetail, taskDetail } from "../src/ui/view/detail.ts";
import { subagentRow, taskRow } from "../src/ui/view/rows.ts";
import type { SubagentConfig } from "../src/domain/subagent/config.ts";
import type { TaskRecord } from "../src/app/task-record.ts";
import { newTaskId } from "../src/app/task-record.ts";

function sub(over: Partial<SubagentConfig> = {}): SubagentConfig {
	return {
		name: "explorer",
		description: "Fast search",
		model: "inherit",
		tools: ["read", "grep", "find", "ls"],
		autonomy: "low",
		systemPrompt: "p",
		source: "user",
		filePath: "/tmp/x.md",
		warnings: [],
		...over,
	};
}

function rec(over: Partial<TaskRecord> = {}): TaskRecord {
	return {
		taskId: newTaskId(),
		subagentName: "explorer",
		description: "map auth",
		status: "running",
		createdAt: Date.now(),
		fullDelivered: false,
		subagent: sub(),
		cwd: "/tmp",
		history: [],
		...over,
	};
}

describe("view", () => {
	it("badges tools groups", () => {
		assert.equal(toolsBadge(undefined), "all");
		assert.equal(toolsBadge(["read", "grep", "find", "ls"]), "read-only");
		assert.equal(toolsBadge(["read", "grep", "find", "ls", "edit", "write"]), "edit");
		assert.equal(toolsBadge(["read", "bash"]), "read+bash");
	});

	it("badges source and kind", () => {
		assert.equal(sourceBadge("project"), "◈ project");
		assert.equal(sourceBadge("user"), "◇ personal");
		assert.equal(kindBadge("foreground"), "● fg");
		assert.equal(kindBadge("alias"), "◐ alias");
		assert.equal(kindBadge("background"), "○ bg");
		assert.equal(kindBadge(undefined), "○ bg");
	});

	it("aligns key tables", () => {
		const t = kvTable([
			["a", "1"],
			["longer", "2"],
		]);
		assert.equal(t, "a       1\nlonger  2");
	});

	it("shortens ids and parses rows", () => {
		assert.equal(shortKey("task-mabc12-34"), "bc1234");
		const r = rec({ kind: "foreground" });
		assert.equal(rowTaskKey(taskRow(r)), shortKey(r.taskId));
	});

	it("cuts long text", () => {
		assert.equal(shortText("a  b\nc", 4), "a b…");
		assert.equal(shortText("hi", 10), "hi");
	});

	it("builds rows and parses names", () => {
		const row = subagentRow(sub());
		assert.ok(row.startsWith("explorer · ◇ personal"));
		assert.equal(rowName(row), "explorer");
	});

	it("shows detail with short fields", () => {
		const d = subagentDetail(sub({ description: "" }));
		assert.ok(d.includes("explorer"));
		assert.ok(d.includes("(none)"));
		assert.ok(!d.includes("runs"));
	});

	it("paints usage lines", () => {
		assert.equal(
			usageLine(
				{ input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.01234, turns: 2 },
				"m",
			),
			"2t 15tok $0.0123 m",
		);
		assert.equal(
			usageLine({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 }),
			"",
		);
	});

	it("paints task rows and detail", () => {
		const r = rec({
			status: "done",
			result: {
				text: "hi",
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
				notes: [],
			},
		});
		assert.ok(taskRow(r).startsWith("✓"));
		assert.ok(taskDetail(r).includes("status"));
		assert.ok(taskDetail(r).includes("done"));
		assert.ok(taskDetail(rec()).includes("still running"));
		const live = taskDetail(rec(), {
			turns: 7,
			tool: "codemode",
			elapsedSec: 95,
			partial: "one moment",
		});
		assert.match(live, /turns 7/);
		assert.match(live, /tool codemode/);
		assert.match(live, /1m/);
		assert.match(live, /one moment/);
		assert.match(live, /running — poll again/);
		assert.ok(taskDetail(rec({ status: "error", error: "boom" })).includes("boom"));
	});

	it("badges run kinds on rows", () => {
		assert.ok(taskRow(rec({ kind: "foreground" })).includes("● fg"));
		assert.ok(taskRow(rec({ kind: "alias" })).includes("◐ alias"));
		assert.ok(taskRow(rec({ kind: "background" })).includes("○ bg"));
		assert.ok(taskRow(rec()).includes("○ bg"));
	});
});

describe("files v2.1", () => {
	it("offers fixed picks for closed fields", () => {
		assert.ok(FIELD_CHOICES.tools.includes("read-only"));
		assert.ok(FIELD_CHOICES.autonomy.includes("low"));
		assert.ok(FIELD_CHOICES.thinkingLevel.includes("high"));
		assert.deepEqual(FIELD_CHOICES.description, []);
		assert.deepEqual(FIELD_CHOICES.model, []);
	});

	it("accepts pick words in validate", () => {
		assert.equal(validateField("tools", "all tools"), null);
		assert.equal(validateField("thinkingLevel", "(inherit)"), null);
	});

	it("builds starter templates", () => {
		const t = templateFromStarter("w2", "Does work", "inherit", "read-only", "low", "Body here");
		assert.ok(t.includes("name: w2"));
		assert.ok(t.includes("Body here"));
		const blank = subagentTemplate("n");
		assert.ok(blank.includes("name: n"));
	});

	it("writes custom content and trashes files", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-"));
		const filePath = path.join(dir, "probe.md");
		const w = writeSubagentFile(dir, "probe", subagentTemplate("probe"));
		assert.ok("path" in w);
		assert.ok(fs.existsSync(filePath));

		const bad = writeSubagentFile(dir, "Bad Name!", "x");
		assert.ok("error" in bad);

		const trashed = trashSubagentFile(filePath);
		assert.ok("trashPath" in trashed);
		assert.ok(!fs.existsSync(filePath));
		if ("trashPath" in trashed) {
			assert.ok(fs.existsSync(trashed.trashPath));
			fs.unlinkSync(trashed.trashPath);
		}
		fs.rmdirSync(dir);
	});
});
