/**
 * The per-entry line cache: wrap once, recolor never.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLineCache, gutterWidth } from "../src/ui/view/line-cache.ts";

function counter() {
	let calls = 0;
	const theme = {
		fg: (_color: string, text: string) => {
			calls += 1;
			return text;
		},
	};
	return { theme, calls: () => calls };
}

const entry = { kind: "agent" as const, label: "agent", text: "line one\nline two" };

describe("line cache", () => {
	it("wraps and colors an entry once", () => {
		const c = counter();
		const cache = createLineCache(c.theme);
		const first = cache.linesFor(entry, 40, 5);
		const afterFirst = c.calls();
		const second = cache.linesFor(entry, 40, 5);
		assert.equal(first, second);
		assert.equal(c.calls(), afterFirst);
		assert.ok(first.length >= 2);
		assert.ok(first[0]?.startsWith("agent  "));
	});

	it("rebuilds when the width or gutter changes", () => {
		const c = counter();
		const cache = createLineCache(c.theme);
		cache.linesFor(entry, 40, 5);
		const before = c.calls();
		cache.linesFor(entry, 20, 5);
		assert.ok(c.calls() > before);
		const afterWidth = c.calls();
		cache.linesFor(entry, 20, 7);
		assert.ok(c.calls() > afterWidth);
	});

	it("keeps the gutter between 6 and 14", () => {
		assert.equal(gutterWidth([{ ...entry, label: "x" }]), 6);
		assert.equal(gutterWidth([{ ...entry, label: "x".repeat(30) }]), 14);
	});

	it("reset drops cached rows", () => {
		const c = counter();
		const cache = createLineCache(c.theme);
		cache.linesFor(entry, 40, 5);
		const before = c.calls();
		cache.reset();
		cache.linesFor(entry, 40, 5);
		assert.ok(c.calls() > before);
	});

	it("collapses a long result to Pi's 10-line preview", () => {
		const text = Array.from({ length: 30 }, (_, i) => `row ${i + 1}`).join("\n");
		const cache = createLineCache(counter().theme);
		const result = { kind: "result" as const, label: "← codemode", text };
		const closed = cache.linesFor(result, 80, 6);
		assert.equal(closed.length, 11);
		assert.match(closed[10] ?? "", /20 more lines, ctrl\+o to expand/);
		assert.doesNotMatch(closed.join("\n"), /row 11/);
		cache.setExpanded(true);
		assert.equal(cache.linesFor(result, 80, 6).length, 30);
		cache.setExpanded(false);
		assert.equal(cache.linesFor(result, 80, 6).length, 11);
	});

	it("collapses errors but not agent prose", () => {
		const text = Array.from({ length: 20 }, (_, i) => `row ${i + 1}`).join("\n");
		const cache = createLineCache(counter().theme);
		assert.equal(cache.linesFor({ kind: "error", label: "← bash", text }, 80, 6).length, 11);
		assert.equal(cache.linesFor({ kind: "agent", label: "agent", text }, 80, 6).length, 20);
	});

	it("gives an empty entry one blank row", () => {
		const cache = createLineCache(counter().theme);
		const rows = cache.linesFor({ kind: "tool", label: "→ bash", text: "" }, 40, 7);
		assert.equal(rows.length, 1);
	});
});
