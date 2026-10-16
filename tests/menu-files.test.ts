/**
 * Names, starters, and the trash.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { listTrash, restoreTrashFile } from "../src/infra/trash.ts";
import { templateFromStarter, validateName, writeSubagentFile } from "../src/infra/files.ts";

describe("names and starters", () => {
	it("validates names", () => {
		assert.equal(validateName("my-worker_2"), null);
		assert.ok(validateName("Bad Name!"));
		assert.ok(validateName(""));
	});

	it("starter keeps all wizard fields", () => {
		const t = templateFromStarter("w2", "Does work", "acme/fast", "edit", "high", "Body here");
		assert.ok(t.includes("name: w2"));
		assert.ok(t.includes("model: acme/fast"));
		assert.ok(t.includes("tools: edit"));
		assert.ok(t.includes("autonomy: high"));
		assert.ok(t.includes("Body here"));
	});

	it("starter omits tools when blank", () => {
		const t = templateFromStarter("w3", "d", "inherit", "", "low", "B");
		assert.ok(t.includes("# tools omitted = all"));
	});

	it("starter writes the codemode choice, and omits the default", () => {
		const off = templateFromStarter("w4", "d", "inherit", "read-only", "low", "B", "off");
		assert.ok(off.includes("codemode: off"));
		const dflt = templateFromStarter(
			"w5",
			"d",
			"inherit",
			"read-only",
			"low",
			"B",
			"(default: only)",
		);
		assert.ok(!dflt.includes("codemode:"));
	});

	it("starter writes the budget line when the wizard sets one", () => {
		const t = templateFromStarter(
			"w6",
			"d",
			"inherit",
			"read-only",
			"low",
			"B",
			"only",
			"{ timeoutSec: 1200 }",
		);
		assert.ok(t.includes("budget: { timeoutSec: 1200 }"));
		const none = templateFromStarter("w7", "d", "inherit", "read-only", "low", "B");
		assert.ok(!none.includes("budget:"));
	});
});
describe("trash restore", () => {
	it("restores a trashed file", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-"));
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-home-"));
		const content = [
			"---",
			"name: probe",
			"description: d",
			"model: inherit",
			"tools: read-only",
			"---",
			"",
			"You are probe.",
			"",
		].join("\n");
		const w = writeSubagentFile(dir, "probe", content);
		assert.ok("path" in w);
		if (!("path" in w)) return;

		const trashed = path.join(home, "probe-2026-01-01.md");
		fs.copyFileSync(w.path, trashed);
		fs.unlinkSync(w.path);

		const back = restoreTrashFile(trashed, dir);
		assert.ok("path" in back);
		if (!("path" in back)) return;
		assert.ok(fs.existsSync(back.path));
		assert.ok(!fs.existsSync(trashed));

		const dup = restoreTrashFile(back.path, dir);
		assert.ok("error" in dup);

		fs.unlinkSync(back.path);
		fs.rmdirSync(dir);
		fs.rmdirSync(home);
	});

	it("lists trash without throwing", () => {
		const items = listTrash();
		assert.ok(Array.isArray(items));
	});
});
