/**
 * Incremental shaping: append, trim, and reset.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTranscriptCursor } from "../src/ui/view/transcript-cursor.ts";

function user(text: string) {
	return { role: "user", content: text };
}

describe("the transcript cursor", () => {
	it("keeps earlier entries when a message is appended", () => {
		const cursor = createTranscriptCursor();
		const messages = [user("one"), user("two")];
		cursor.pull(messages);
		const before = cursor.entries();
		messages.push(user("three"));
		cursor.pull(messages);
		const after = cursor.entries();
		assert.equal(after.length, 3);
		assert.equal(before[0], after[0], "same entry object, so its wrapped rows stay cached");
		assert.equal(after.at(-1)?.text, "three");
	});

	it("caps entries and says how many went", () => {
		const cursor = createTranscriptCursor(5);
		cursor.pull(Array.from({ length: 8 }, (_, i) => user(`step ${i}`)));
		const out = cursor.entries();
		assert.equal(out.length, 6);
		assert.equal(out[0]?.text, "3 earlier entries hidden");
		assert.equal(out.at(-1)?.text, "step 7");
	});

	it("trims the oldest text over budget", () => {
		const cursor = createTranscriptCursor(400, 250);
		cursor.pull(Array.from({ length: 10 }, (_, i) => user(`${"u".repeat(100)}${i}`)));
		const out = cursor.entries();
		assert.equal(out[0]?.text, "8 earlier entries hidden");
		assert.equal(out.length, 3);
	});

	it("starts over when history shrinks", () => {
		const cursor = createTranscriptCursor();
		cursor.pull([user("one"), user("two"), user("three")]);
		cursor.pull([user("only")]);
		const out = cursor.entries();
		assert.deepEqual(
			out.map((e) => e.text),
			["only"],
		);
	});

	it("starts over when the boundary message is replaced", () => {
		const cursor = createTranscriptCursor();
		const first = user("one");
		cursor.pull([first, user("two")]);
		cursor.pull([user("rewritten"), user("two")]);
		const out = cursor.entries();
		assert.equal(out[0]?.text, "rewritten");
		assert.equal(out[1]?.text, "two");
	});

	it("clears on an empty history", () => {
		const cursor = createTranscriptCursor();
		cursor.pull([user("one")]);
		cursor.pull([]);
		assert.deepEqual(cursor.entries(), []);
	});
});
