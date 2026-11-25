import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SubagentConfig } from "../src/domain/subagent/index.ts";
import { MAX_PROMPT_PREFIX_CHARS } from "../src/domain/subagent/index.ts";
import { taskPrompt } from "../src/domain/subagent/index.ts";
import { editSubagentField } from "../src/infra/files/index.ts";
import { loadSubagentFromContent } from "../src/infra/files/index.ts";

function sub(over: Partial<SubagentConfig> = {}): SubagentConfig {
	return {
		name: "x",
		description: "",
		model: "inherit",
		autonomy: "inherit",
		systemPrompt: "p",
		source: "user",
		filePath: "f",
		warnings: [],
		...over,
	};
}

function load(extra: string): SubagentConfig | string {
	return loadSubagentFromContent(`---\nname: x\n${extra}---\n\nbody\n`, "t.md", "user");
}

function prefixOf(extra: string): string | undefined {
	const parsed = load(extra);
	if (typeof parsed === "string") assert.fail(parsed);
	return parsed.promptPrefix;
}

describe("taskPrompt", () => {
	it("puts the prefix first, then the task verbatim", () => {
		const text = taskPrompt(sub({ promptPrefix: "You map code. Cite file:line." }), "get overview");
		assert.equal(text, "You map code. Cite file:line.\n\nget overview");
	});

	it("keeps a task untouched without a prefix", () => {
		assert.equal(taskPrompt(sub(), "get overview this repo"), "get overview this repo");
		assert.equal(taskPrompt(sub({ promptPrefix: "   " }), "a\nb"), "a\nb");
	});

	it("keeps newlines and free text in the task", () => {
		const text = taskPrompt(sub({ promptPrefix: "p" }), "line one\nline two");
		assert.equal(text, "p\n\nline one\nline two");
	});
});

describe("promptPrefix in a subagent file", () => {
	it("reads one line", () => {
		assert.equal(prefixOf("promptPrefix: Map first, then answer.\n"), "Map first, then answer.");
	});

	it("reads a quoted value with a colon", () => {
		assert.equal(
			prefixOf('promptPrefix: "Map code: cite file:line."\n'),
			"Map code: cite file:line.",
		);
	});

	it("collapses a folded value to one line", () => {
		assert.equal(prefixOf("promptPrefix: >\n  one\n  two\n"), "one two");
	});

	it("treats blank as absent", () => {
		assert.equal(prefixOf('promptPrefix: ""\n'), undefined);
		assert.equal(sub().promptPrefix, undefined);
	});

	it("rejects a non-string", () => {
		const parsed = load("promptPrefix: [a, b]\n");
		assert.equal(typeof parsed, "string");
		assert.match(String(parsed), /promptPrefix/);
	});

	it("rejects a value over the cap", () => {
		const parsed = load(`promptPrefix: ${"x".repeat(MAX_PROMPT_PREFIX_CHARS + 1)}\n`);
		assert.equal(typeof parsed, "string");
		assert.match(String(parsed), /at most 400/);
	});
});

describe("editing the prefix", () => {
	it("writes a parsed value and clears it again", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-prefix-"));
		const file = path.join(dir, "x.md");
		try {
			fs.writeFileSync(file, "---\nname: x\ndescription: d\n---\n\nbody\n");
			assert.equal(editSubagentField(file, "promptPrefix", "Map code: cite file:line."), null);
			const written = fs.readFileSync(file, "utf8");
			assert.match(written, /^promptPrefix: "Map code: cite file:line\."$/m);
			const parsed = loadSubagentFromContent(written, file, "user");
			assert.equal(
				typeof parsed === "object" ? parsed.promptPrefix : parsed,
				"Map code: cite file:line.",
			);
			assert.equal(editSubagentField(file, "promptPrefix", ""), null);
			assert.doesNotMatch(fs.readFileSync(file, "utf8"), /promptPrefix/);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects an over-long prefix before writing", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-prefix-"));
		const file = path.join(dir, "x.md");
		try {
			fs.writeFileSync(file, "---\nname: x\ndescription: d\n---\n\nbody\n");
			const err = editSubagentField(file, "promptPrefix", "x".repeat(MAX_PROMPT_PREFIX_CHARS + 1));
			assert.match(String(err), /at most|over/);
			assert.doesNotMatch(fs.readFileSync(file, "utf8"), /promptPrefix/);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
