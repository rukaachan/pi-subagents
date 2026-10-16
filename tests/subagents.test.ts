import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	clampToolsForAutonomy,
	resolveToolPolicy,
	type SubagentConfig,
} from "../src/domain/subagent/config.ts";
import { loadSubagentFromContent } from "../src/infra/subagent-files.ts";

function sub(over: Partial<SubagentConfig>): SubagentConfig {
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

describe("loadSubagentFromContent", () => {
	it("loads a valid subagent", () => {
		const r = loadSubagentFromContent(
			"---\nname: a1\ndescription: d\nmodel: inherit\ntools: read-only\n---\n\nprompt",
			"t.md",
			"user",
		);
		assert.equal(typeof r, "object");
		if (typeof r !== "object") return;
		assert.equal(r.name, "a1");
		assert.deepEqual(r.tools, ["read", "grep", "find", "ls"]);
	});

	it("rejects bad name", () => {
		const r = loadSubagentFromContent("---\nname: Bad Name!\n---\n\np", "t.md", "user");
		assert.equal(typeof r, "string");
	});

	it("rejects empty body", () => {
		const r = loadSubagentFromContent("---\nname: b\n---\n\n   ", "t.md", "user");
		assert.equal(typeof r, "string");
	});

	it("rejects unknown tool", () => {
		const r = loadSubagentFromContent(
			"---\nname: c\ntools: [read, nope]\n---\n\np",
			"t.md",
			"user",
		);
		assert.equal(typeof r, "string");
	});

	it("rejects tools all", () => {
		const r = loadSubagentFromContent("---\nname: d\ntools: all\n---\n\np", "t.md", "user");
		assert.equal(typeof r, "string");
	});

	it("rejects bad thinkingLevel", () => {
		const r = loadSubagentFromContent(
			"---\nname: e\nmodel: x/y\nthinkingLevel: ultra\n---\n\np",
			"t.md",
			"user",
		);
		assert.equal(typeof r, "string");
	});

	it("rejects bad autonomy", () => {
		const r = loadSubagentFromContent("---\nname: f\nautonomy: god\n---\n\np", "t.md", "user");
		assert.equal(typeof r, "string");
	});

	it("accepts reasoningEffort alias", () => {
		const r = loadSubagentFromContent(
			"---\nname: g\nmodel: x/y\nreasoningEffort: high\n---\n\np",
			"t.md",
			"user",
		);
		assert.equal(typeof r, "object");
		if (typeof r !== "object") return;
		assert.equal(r.thinkingLevel, "high");
	});

	it("warns on missing description but loads", () => {
		const r = loadSubagentFromContent("---\nname: h\n---\n\np", "t.md", "user");
		assert.equal(typeof r, "object");
		if (typeof r !== "object") return;
		assert.ok(r.warnings.some((w) => w.includes("description")));
	});
});

describe("resolveToolPolicy", () => {
	it("omitted means all", () => {
		assert.equal(resolveToolPolicy(undefined), undefined);
	});

	it("expands groups", () => {
		assert.deepEqual(resolveToolPolicy("read-only"), ["read", "grep", "find", "ls"]);
		assert.deepEqual(resolveToolPolicy("edit"), ["read", "grep", "find", "ls", "edit", "write"]);
		assert.deepEqual(resolveToolPolicy("execute"), [
			"read",
			"grep",
			"find",
			"ls",
			"edit",
			"write",
			"bash",
		]);
	});

	it("accepts string and array lists", () => {
		assert.deepEqual(resolveToolPolicy("read, bash"), ["read", "bash"]);
		assert.deepEqual(resolveToolPolicy(["read", "bash"]), ["read", "bash"]);
	});
});

describe("clampToolsForAutonomy", () => {
	it("clamps off to read-only", () => {
		const r = clampToolsForAutonomy(sub({ autonomy: "off", tools: ["read", "bash"] }));
		assert.deepEqual(r.tools, ["read"]);
	});

	it("clamps off with no tools to read-only group", () => {
		const r = clampToolsForAutonomy(sub({ autonomy: "off", tools: undefined }));
		assert.deepEqual(r.tools, ["read", "grep", "find", "ls"]);
	});

	it("notes read-only subagent above low", () => {
		const r = clampToolsForAutonomy(sub({ autonomy: "high", tools: ["read", "ls"] }));
		assert.ok(r.notes.some((n) => n.includes("never runs above low")));
	});
});

describe("suggestSubagentName", () => {
	it("suggests near names", async () => {
		const { suggestSubagentName } = await import("../src/domain/subagent/discovery.ts");
		assert.equal(suggestSubagentName("explore", ["explorer", "worker"]), "explorer");
		assert.equal(suggestSubagentName("EXPLORER", ["explorer", "worker"]), "explorer");
		assert.equal(suggestSubagentName("zzz", ["explorer", "worker"]), null);
	});
});
