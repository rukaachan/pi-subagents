import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadSubagentFromContent } from "../src/infra/files/index.ts";
import { decodeState, STATE_VERSION } from "../src/infra/state/index.ts";
import { currentFieldValue } from "../src/ui/menu/root/index.ts";
import {
	EDITABLE_FIELDS,
	FIELD_CHOICES,
	editSubagentField,
	validateField,
} from "../src/infra/files/index.ts";
import { rec, sub } from "./board-fixtures.ts";

const FRONT = (fm: string) => `---\n${fm}\n---\n\nbody text\n`;
const load = (fm: string) => loadSubagentFromContent(FRONT(fm), "/x.md", "user");

describe("mcp frontmatter", () => {
	it("parses opt-in at medium or higher", () => {
		const cfg = load("name: a\nautonomy: medium\nmcp: true\ncodemode: only");
		assert.ok(typeof cfg !== "string");
		assert.equal(cfg.mcp, true);
	});

	it("accepts on and off words, and false means absent", () => {
		const on = load("name: a\nautonomy: high\nmcp: on");
		assert.ok(typeof on !== "string");
		assert.equal(on.mcp, true);
		const off = load("name: a\nautonomy: high\nmcp: off");
		assert.ok(typeof off !== "string");
		assert.equal(off.mcp, undefined);
	});

	it("rejects a non-boolean", () => {
		const cfg = load("name: a\nautonomy: medium\nmcp: sometimes");
		if (typeof cfg !== "string") assert.fail("a non-boolean mcp must fail to load");
		assert.match(cfg, /invalid mcp sometimes/);
	});

	it("rejects low and off autonomy", () => {
		for (const autonomy of ["off", "low"]) {
			const cfg = load(`name: a\nautonomy: ${autonomy}\nmcp: true`);
			assert.equal(typeof cfg, "string", autonomy);
			assert.match(cfg as string, /medium or higher/, autonomy);
		}
	});

	it("rejects codemode off", () => {
		const cfg = load("name: a\nautonomy: medium\nmcp: true\ncodemode: off");
		assert.equal(typeof cfg, "string");
		assert.match(cfg as string, /codemode/);
	});

	it("rejects a path fence", () => {
		const cfg = load("name: a\nautonomy: high\nmcp: true\npaths: src");
		assert.equal(typeof cfg, "string");
		assert.match(cfg as string, /not path-fenced/);
	});

	it("rejects mcp__ tools without the opt-in", () => {
		const cfg = load("name: a\nautonomy: medium\ntools: read, mcp__echo__echo");
		assert.equal(typeof cfg, "string");
		assert.match(cfg as string, /require mcp: true/);
	});
});

describe("child trust state and editor", () => {
	it("decodes gates and context on a saved row", () => {
		const parsed = decodeState(
			JSON.stringify({
				version: STATE_VERSION,
				savedAt: 1,
				tasks: [rec({ taskId: "task-gates", subagent: { ...sub(), gates: true, context: true } })],
			}),
		);
		assert.equal(parsed?.tasks[0]?.subagent.gates, true);
		assert.equal(parsed?.tasks[0]?.subagent.context, true);
	});

	it("offers both fields in the editor and validates them", () => {
		for (const field of ["gates", "context"] as const) {
			assert.ok(EDITABLE_FIELDS.includes(field));
			assert.ok(FIELD_CHOICES[field].includes("on"));
			assert.equal(validateField(field, "on"), null);
			assert.equal(validateField(field, "maybe"), "Use on, off, or (default: off).");
		}
	});

	it("writes gates on disk and reads it back", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-gates-"));
		try {
			const file = path.join(dir, "gate-agent.md");
			fs.writeFileSync(file, FRONT("name: a\nautonomy: high"));
			assert.equal(editSubagentField(file, "gates", "on"), null);
			const cfg = loadSubagentFromContent(fs.readFileSync(file, "utf8"), file, "user");
			assert.ok(typeof cfg !== "string");
			assert.equal(cfg.gates, true);
			assert.equal(currentFieldValue(cfg, "gates"), "on");
			assert.equal(editSubagentField(file, "gates", "off"), null);
			const off = loadSubagentFromContent(fs.readFileSync(file, "utf8"), file, "user");
			assert.ok(typeof off !== "string");
			assert.equal(off.gates, undefined);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("mcp state and editor", () => {
	it("decodes mcp on a saved row", () => {
		const parsed = decodeState(
			JSON.stringify({
				version: STATE_VERSION,
				savedAt: 1,
				tasks: [rec({ taskId: "task-mcp", subagent: { ...sub(), mcp: true } })],
			}),
		);
		assert.equal(parsed?.tasks[0]?.subagent.mcp, true);
	});

	it("offers mcp in the editor and validates it", () => {
		assert.ok(EDITABLE_FIELDS.includes("mcp"));
		assert.ok(FIELD_CHOICES.mcp.includes("on"));
		assert.equal(validateField("mcp", "on"), null);
		assert.equal(validateField("mcp", "sometimes"), "Use on, off, or (default: off).");
	});

	it("edits the field on disk and reads it back", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-mcp-"));
		try {
			const file = path.join(dir, "mcp-agent.md");
			fs.writeFileSync(file, FRONT("name: a\nautonomy: medium\nmcp: false"));
			assert.equal(editSubagentField(file, "mcp", "on"), null);
			const cfg = loadSubagentFromContent(fs.readFileSync(file, "utf8"), file, "user");
			assert.ok(typeof cfg !== "string");
			assert.equal(cfg.mcp, true);
			assert.equal(currentFieldValue(cfg, "mcp"), "on");
			assert.equal(editSubagentField(file, "mcp", "off"), null);
			const off = loadSubagentFromContent(fs.readFileSync(file, "utf8"), file, "user");
			assert.ok(typeof off !== "string");
			assert.equal(off.mcp, undefined);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
