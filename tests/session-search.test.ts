/**
 * Search inside the transcript viewer.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { screen, user } from "./session-fixture.ts";

describe("transcript search in the viewer", () => {
	it("finds text with /, steps with n/N, and only escapes the input first", () => {
		const made = screen({
			source: () => [user("alpha needle"), user("beta"), user("gamma needle")],
		});
		made.view.render(80);
		made.view.handleInput("/");
		assert.match(made.view.render(80)[1] ?? "", /find: ▌/);
		for (const char of "needle") made.view.handleInput(char);
		assert.match(made.view.render(80)[1] ?? "", /find: needle▌/);
		made.view.handleInput("\r");
		assert.match(made.view.render(80)[1] ?? "", /1\/2/);
		assert.equal(made.closes(), 0);
		made.view.handleInput("n");
		assert.match(made.view.render(80)[1] ?? "", /2\/2/);
		made.view.handleInput("N");
		assert.match(made.view.render(80)[1] ?? "", /1\/2/);
		made.view.handleInput("\x1b");
		assert.equal(made.closes(), 1, "esc outside search still closes the viewer");
	});

	it("says no match and cancels an open input without closing", () => {
		const made = screen();
		made.view.render(80);
		made.view.handleInput("/");
		for (const char of "zzz") made.view.handleInput(char);
		made.view.handleInput("\r");
		assert.match(made.view.render(80)[1] ?? "", /no match/);
		made.view.handleInput("n");
		assert.match(made.view.render(80)[1] ?? "", /no match/);
		made.view.handleInput("/");
		made.view.handleInput("\x1b");
		assert.equal(made.closes(), 0);
		const out = made.view.render(80).join("\n");
		assert.doesNotMatch(out, /find:|no match/);
		assert.match(out, /Task: map the rust engine/);
	});
});
