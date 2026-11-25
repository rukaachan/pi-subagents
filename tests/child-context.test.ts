import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contextNote } from "../src/infra/guard/index.ts";

describe("the context note is the visible cost", () => {
	it("counts files and chars and names the ones inside the workspace", () => {
		const note = contextNote(
			[
				{ path: "/work/AGENTS.md", content: "abc" },
				{ path: "/work/src/AGENTS.md", content: "defgh" },
			],
			"/work",
		);
		assert.equal(note, "context: 2 files, 8 chars (AGENTS.md, src/AGENTS.md)");
	});

	it("uses one word for a single file and says zero when nothing loaded", () => {
		assert.equal(
			contextNote([{ path: "/w/AGENTS.md", content: "a" }], "/w"),
			"context: 1 file, 1 chars (AGENTS.md)",
		);
		assert.equal(contextNote([], "/w"), "context: 0 files, 0 chars");
	});

	it("shortens a file outside the workspace to its name and caps the list", () => {
		const note = contextNote(
			[
				{ path: "/home/u/.pi/agent/AGENTS.md", content: "x" },
				{ path: "/w/a/AGENTS.md", content: "x" },
				{ path: "/w/b/AGENTS.md", content: "x" },
				{ path: "/w/c/AGENTS.md", content: "x" },
				{ path: "/w/d/AGENTS.md", content: "x" },
			],
			"/w",
		);
		assert.equal(
			note,
			"context: 5 files, 5 chars (AGENTS.md, a/AGENTS.md, b/AGENTS.md, c/AGENTS.md, …)",
		);
	});
});
