/**
 * The tools/paths fence: temp tools narrow, writes stay in bounds.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { parsePaths } from "../src/domain/subagent/paths.ts";
import { registerTemp } from "../src/domain/temp.ts";
import { loadSubagentFromContent } from "../src/infra/subagent-files.ts";
import { guardPaths, isPathAllowed } from "../src/infra/tool-guard.ts";

const def = (over: Record<string, unknown> = {}) => ({
	name: "t-scope",
	description: "d",
	systemPrompt: "p",
	...over,
});

describe("parsePaths", () => {
	it("takes a comma string or a list", () => {
		for (const [raw, want] of [
			["src, docs/", ["src", "docs/"]],
			[
				["src", "src", "lib"],
				["src", "lib"],
			],
			[undefined, []],
		] as const) {
			const parsed = parsePaths(raw);
			assert.equal(parsed.ok, true);
			if (!parsed.ok) continue;
			assert.deepEqual(parsed.paths, want);
		}
	});

	it("rejects empty and oversized lists", () => {
		assert.equal(parsePaths(" , ").ok, false);
		assert.equal(parsePaths([]).ok, false);
		assert.equal(parsePaths(Array.from({ length: 21 }, (_, i) => `d${i}`)).ok, false);
		assert.equal(parsePaths([1]).ok, false);
	});
});

describe("isPathAllowed", () => {
	const cwd = "/repo";
	it("allows the root and anything under it", () => {
		assert.equal(isPathAllowed("src", ["src"], cwd), true);
		assert.equal(isPathAllowed("src/a/b.ts", ["src"], cwd), true);
		assert.equal(isPathAllowed("/repo/src/a.ts", ["src"], cwd), true);
	});

	it("refuses siblings, parents and lookalike prefixes", () => {
		assert.equal(isPathAllowed("../out.txt", ["src"], cwd), false);
		assert.equal(isPathAllowed("src-evil/a.ts", ["src"], cwd), false);
		assert.equal(isPathAllowed("/tmp/a.ts", ["src"], cwd), false);
		assert.equal(isPathAllowed("docs/a.md", ["src"], cwd), false);
	});
});

describe("frontmatter paths", () => {
	it("loads the fence", () => {
		const r = loadSubagentFromContent(
			"---\nname: fenced\ndescription: d\npaths: [src, docs]\n---\n\np",
			"t.md",
			"user",
		);
		assert.equal(typeof r, "object");
		if (typeof r !== "object") return;
		assert.deepEqual(r.paths, ["src", "docs"]);
	});

	it("refuses an empty fence", () => {
		const r = loadSubagentFromContent(
			"---\nname: fenced\ndescription: d\npaths: []\n---\n\np",
			"t.md",
			"user",
		);
		assert.equal(typeof r, "string");
	});
});

describe("temp tools narrow, never widen", () => {
	it("refuses a tool the caller does not have", () => {
		const r = registerTemp(def({ tools: ["read", "bash"] }), [], ["read"]);
		assert.equal(r.ok, false);
		if (r.ok) return;
		assert.match(r.error, /bash/);
		assert.match(r.error, /never widen/);
	});

	it("accepts a subset and an omitted list", () => {
		const subset = registerTemp(def({ tools: ["read"] }), [], ["read", "bash"]);
		assert.equal(subset.ok, true);
		const bare = registerTemp(def({ name: "t-bare" }), [], ["read"]);
		assert.equal(bare.ok, true);
	});

	it("keeps the old behavior without a caller list", () => {
		const r = registerTemp(def({ name: "t-now", tools: ["bash"] }), []);
		assert.equal(r.ok, true);
	});
});

describe("the write fence", () => {
	it("writes inside, refuses outside", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-scope-"));
		try {
			const tool = guardPaths(createWriteToolDefinition(dir), ["src"], dir);
			const ctx = { cwd: dir } as unknown as ExtensionToolContext;
			const inside = await tool.execute(
				"call-1",
				{ path: "src/ok.txt", content: "hello" },
				undefined,
				undefined,
				ctx,
			);
			assert.equal(inside.isError, undefined);
			assert.equal(existsSync(join(dir, "src/ok.txt")), true);

			const outside = await tool.execute(
				"call-2",
				{ path: "../escape.txt", content: "nope" },
				undefined,
				undefined,
				ctx,
			);
			assert.equal(outside.isError, true);
			const text = outside.content[0];
			assert.equal(text?.type, "text");
			if (text?.type === "text") assert.match(text.text, /outside this subagent paths/);
			assert.equal(existsSync(join(dir, "..", "escape.txt")), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
