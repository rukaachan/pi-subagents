import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFind, findMatches } from "../src/ui/view/session/index.ts";

const LINES = ["alpha needle", "beta", "gamma NEEDLE", "delta"];

function typed(query: string) {
	const find = createFind();
	find.begin();
	for (const char of query) find.type(char);
	return find;
}

describe("transcript search", () => {
	it("matches literally and ignores case", () => {
		assert.deepEqual(findMatches(LINES, "needle"), [0, 2]);
		assert.deepEqual(findMatches(LINES, "NEEDLE"), [0, 2]);
		assert.deepEqual(findMatches(LINES, "gamma"), [2]);
	});

	it("treats regex characters as plain text", () => {
		const lines = ["a.b", "axb", "a*b"];
		assert.deepEqual(findMatches(lines, "."), [0]);
		assert.deepEqual(findMatches(lines, "a*b"), [2]);
		assert.deepEqual(findMatches(lines, "[x]"), []);
	});

	it("returns nothing for an empty or blank query", () => {
		assert.deepEqual(findMatches(LINES, ""), []);
		assert.deepEqual(findMatches(LINES, "   "), []);
	});

	it("keeps the query on enter and steps both ways with a wrap", () => {
		const find = typed("needle");
		assert.equal(find.view().label, "find: needle▌");
		assert.equal(find.commit(LINES), 0, "enter jumps to the first hit");
		assert.equal(find.view().label, "1/2");
		assert.equal(find.step(1, LINES), 2);
		assert.equal(find.view().label, "2/2");
		assert.equal(find.step(1, LINES), 0, "n wraps");
		assert.equal(find.view().label, "1/2");
		assert.equal(find.step(-1, LINES), 2, "N wraps back");
		assert.equal(find.view().label, "2/2");
	});

	it("says no match and stays put on a miss", () => {
		const find = typed("nothing here");
		assert.equal(find.commit(LINES), undefined);
		assert.equal(find.view().label, "no match");
		assert.equal(find.step(1, LINES), undefined);
		assert.equal(find.view().label, "no match");
	});

	it("cancels the input without a query and edits with backspace", () => {
		const find = typed("needlex");
		find.backspace();
		assert.equal(find.view().query, "needle");
		find.cancel();
		assert.equal(find.editing, false);
		assert.equal(find.view().label, "");
		assert.equal(find.view().query, "");
	});

	it("does not search while the input is still open", () => {
		const find = typed("needle");
		assert.equal(find.step(1, LINES), undefined);
	});
});
