import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TaskStore } from "../src/app/task-store.ts";
import {
	newRecord,
	newTaskId,
	MAX_LIVE_TASKS,
	MAX_DONE_TASKS,
	type TaskRecord,
} from "../src/app/task-record.ts";
import type { SubagentConfig } from "../src/domain/subagent/config.ts";
import {
	BUDGET_EDIT_FIELDS,
	EDITABLE_FIELDS,
	subagentTemplate,
	createSubagentFile,
	currentBudgetValue,
	editBudgetField,
	editSubagentField,
	validateField,
} from "../src/infra/files.ts";
import { loadSubagentFromContent } from "../src/infra/subagent-files.ts";
import { deleteSubagentFile } from "../src/infra/trash.ts";

function rec(over: Partial<TaskRecord> = {}): TaskRecord {
	return {
		taskId: newTaskId(),
		subagentName: "explorer",
		description: "t",
		status: "running",
		createdAt: Date.now(),
		fullDelivered: false,
		subagent: {
			name: "explorer",
			description: "",
			model: "inherit",
			autonomy: "low",
			systemPrompt: "p",
			source: "user",
			filePath: "f",
			warnings: [],
		},
		cwd: "/tmp",
		history: [],
		...over,
	};
}

describe("TaskStore", () => {
	it("makes unique task ids", () => {
		assert.notEqual(newTaskId(), newTaskId());
	});

	it("caps live tasks at 12", () => {
		const s = new TaskStore();
		assert.equal(MAX_LIVE_TASKS, 12);
		for (let i = 0; i < 12; i++) s.add(rec());
		assert.equal(s.canStart(), false);
		assert.equal(s.liveCount(), 12);
	});

	it("allows start below cap", () => {
		const s = new TaskStore();
		s.add(rec());
		assert.equal(s.canStart(), true);
	});

	it("newRecord tags kind and starts running", () => {
		const sub = rec().subagent as SubagentConfig;
		const r = newRecord(sub, "map", "/tmp", "foreground");
		assert.equal(r.kind, "foreground");
		assert.equal(r.status, "running");
		assert.equal(r.subagentName, "explorer");
	});

	it("done tasks free live slots", () => {
		const s = new TaskStore();
		const r = rec();
		s.add(r);
		r.status = "done";
		assert.equal(s.liveCount(), 0);
		assert.equal(s.canStart(), true);
	});

	it("keeps max 20 done tasks", () => {
		const s = new TaskStore();
		assert.equal(MAX_DONE_TASKS, 20);
		const ids: string[] = [];
		for (let i = 0; i < 25; i++) {
			const r = rec({ status: "done" });
			ids.push(r.taskId);
			s.add(r);
		}
		const [kept, pruned] = [ids[24], ids[0]];
		assert.ok(pruned !== undefined, "oldest id known");
		assert.ok(kept !== undefined, "newest id known");
		assert.equal(s.get(pruned), undefined);
		assert.ok(s.get(kept));
		assert.equal(s.list().filter((t) => t.status === "done").length, 20);
	});
});

describe("files", () => {
	it("template parses as valid subagent", () => {
		assert.ok(subagentTemplate("demo").includes("name: demo"));
	});

	it("validateField accepts good values", () => {
		assert.equal(validateField("model", "inherit"), null);
		assert.equal(validateField("model", "a/b"), null);
		assert.equal(validateField("thinkingLevel", "high"), null);
		assert.equal(validateField("tools", "read-only"), null);
		assert.equal(validateField("tools", "read, bash"), null);
		assert.equal(validateField("autonomy", "low"), null);
		assert.equal(validateField("codemode", "off"), null);
		assert.equal(validateField("codemode", "only"), null);
		assert.equal(validateField("codemode", "(default: only)"), null);
	});

	it("offers codemode and every budget cap in the editor", () => {
		assert.ok(EDITABLE_FIELDS.includes("codemode"));
		assert.deepEqual(
			[...BUDGET_EDIT_FIELDS],
			["timeoutSec", "maxTurns", "maxInputTokens", "maxReportChars"],
		);
	});

	it("validateField rejects bad values", () => {
		assert.ok(validateField("model", "nope"));
		assert.ok(validateField("thinkingLevel", "ultra"));
		assert.ok(validateField("tools", "nope-tool"));
		assert.ok(validateField("autonomy", "god"));
		assert.ok(validateField("codemode", "sometimes"));
	});

	it("create, edit, delete round trip", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-"));
		const created = createSubagentFile(dir, "probe");
		assert.ok("path" in created);
		if (!("path" in created)) return;
		assert.ok(fs.existsSync(created.path));

		const dup = createSubagentFile(dir, "probe");
		assert.ok("error" in dup);

		const badName = createSubagentFile(dir, "Bad Name!");
		assert.ok("error" in badName);

		assert.equal(editSubagentField(created.path, "model", "a/b"), null);
		assert.equal(
			editSubagentField(created.path, "model", "nope"),
			'Use "inherit" or "provider/id".',
		);
		const after = fs.readFileSync(created.path, "utf-8");
		assert.ok(after.includes("model: a/b"));

		assert.equal(deleteSubagentFile(created.path), null);
		assert.ok(!fs.existsSync(created.path));
		fs.rmdirSync(dir);
	});

	it("edits a file that carries a budget without corrupting it", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-"));
		const file = path.join(dir, "worker.md");
		fs.copyFileSync("subagents/worker.md", file);
		assert.equal(editSubagentField(file, "description", "Changed text."), null);
		const text = fs.readFileSync(file, "utf-8");
		assert.ok(text.includes("description: Changed text."));
		assert.ok(
			text.includes(
				"budget: { maxTurns: 0, maxInputTokens: 0, timeoutSec: 5400, maxReportChars: 6000 }",
			),
		);
		const loaded = loadSubagentFromContent(text, file, "user");
		assert.ok(typeof loaded !== "string", "the edited file still parses");
		if (typeof loaded !== "string") assert.equal(loaded.budget?.timeoutSec, 5400);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("switches codemode off, on, only, and back to the default", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-"));
		const created = createSubagentFile(dir, "probe");
		assert.ok("path" in created);
		if (!("path" in created)) return;

		assert.equal(editSubagentField(created.path, "codemode", "off"), null);
		let loaded = loadSubagentFromContent(
			fs.readFileSync(created.path, "utf-8"),
			created.path,
			"user",
		);
		assert.ok(typeof loaded !== "string" && loaded.codemode === false);

		assert.equal(editSubagentField(created.path, "codemode", "on"), null);
		loaded = loadSubagentFromContent(fs.readFileSync(created.path, "utf-8"), created.path, "user");
		assert.ok(typeof loaded !== "string" && loaded.codemode === true);

		assert.equal(editSubagentField(created.path, "codemode", "only"), null);
		loaded = loadSubagentFromContent(fs.readFileSync(created.path, "utf-8"), created.path, "user");
		assert.ok(typeof loaded !== "string" && loaded.codemode === "only");

		assert.equal(editSubagentField(created.path, "codemode", "(default: only)"), null);
		loaded = loadSubagentFromContent(fs.readFileSync(created.path, "utf-8"), created.path, "user");
		assert.ok(typeof loaded !== "string" && loaded.codemode === undefined);
		assert.ok(!fs.readFileSync(created.path, "utf-8").includes("codemode:"));
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("edits one budget cap, rejects a bad one, and clears the block", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-"));
		const created = createSubagentFile(dir, "probe");
		assert.ok("path" in created);
		if (!("path" in created)) return;

		assert.equal(editBudgetField(created.path, "timeoutSec", "120"), null);
		let loaded = loadSubagentFromContent(
			fs.readFileSync(created.path, "utf-8"),
			created.path,
			"user",
		);
		assert.ok(typeof loaded !== "string" && loaded.budget?.timeoutSec === 120);
		assert.equal(currentBudgetValue(loaded as never, "timeoutSec"), "120");

		assert.ok(editBudgetField(created.path, "timeoutSec", "1.5"));
		assert.ok(editBudgetField(created.path, "timeoutSec", "-1"));

		assert.equal(editBudgetField(created.path, "timeoutSec", ""), null);
		loaded = loadSubagentFromContent(fs.readFileSync(created.path, "utf-8"), created.path, "user");
		if (typeof loaded === "string") return assert.fail(loaded);
		assert.equal(loaded.budget, undefined);
		assert.ok(!fs.readFileSync(created.path, "utf-8").includes("budget:"));
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
