/**
 * Quick create: a valid starter, a fallback name, and a clean refusal.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuickSubagent } from "../src/ui/commands/index.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-quick-"));
}

describe("quick create", () => {
	it("writes a read-only starter with the prompt body", () => {
		const dir = tempDir();
		try {
			const made = createQuickSubagent(dir, {
				name: "reviewer",
				description: "Reviews a diff.",
				prompt: "Read the diff and report findings.",
			});
			assert.equal(made.ok, true);
			if (!made.ok) return;
			const text = readFileSync(made.path, "utf8");
			assert.match(text, /^name: reviewer$/m);
			assert.match(text, /^description: Reviews a diff\.$/m);
			assert.match(text, /^model: inherit$/m);
			assert.match(text, /^tools: read-only$/m);
			assert.match(text, /^autonomy: low$/m);
			assert.match(text, /Read the diff and report findings\./);
			assert.doesNotMatch(text, /budget:/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("numbers a name collision instead of overwriting", () => {
		const dir = tempDir();
		try {
			const first = createQuickSubagent(dir, {
				name: "worker",
				description: "One.",
				prompt: "First.",
			});
			assert.equal(first.ok, true);
			const second = createQuickSubagent(dir, {
				name: "worker",
				description: "Two.",
				prompt: "Second.",
			});
			assert.equal(second.ok, true);
			if (!second.ok) return;
			assert.equal(second.name, "worker-2");
			assert.match(readFileSync(second.path, "utf8"), /^name: worker-2$/m);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses an invalid name without writing", () => {
		const dir = tempDir();
		try {
			const made = createQuickSubagent(dir, {
				name: "Bad Name",
				description: "No.",
				prompt: "No.",
			});
			assert.equal(made.ok, false);
			if (made.ok) return;
			assert.match(made.error, /Invalid name/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
