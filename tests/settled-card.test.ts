/**
 * The settled card: collapsed and expanded, per status.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cardLines, registerSettledCard } from "../src/ui/view/run/index.ts";
import type { SettleDetails } from "../src/telemetry/notify/index.ts";

function plainTheme() {
	return { fg: (_token: string, text: string) => text, bold: (text: string) => text };
}

function details(over: Partial<SettleDetails> = {}): SettleDetails {
	return {
		taskId: "task-abc",
		subagent: "worker",
		status: "done",
		elapsedMs: 42_000,
		turns: 3,
		tokens: 8_100,
		cost: 0.0031,
		reportChars: 22,
		delivered: false,
		report: "mapped the engine fine",
		...over,
	};
}

describe("the settled card", () => {
	it("keeps the report behind ctrl+o when collapsed", () => {
		const lines = cardLines(details(), false, plainTheme());
		const all = lines.join("\n");
		assert.match(all, /✓  worker  task-abc  DONE in 42s/);
		assert.match(all, /3 turns/);
		assert.match(all, /8\.1k tok/);
		assert.match(all, /\$0\.003/);
		assert.match(all, /report 22 chars · ctrl\+o to read/);
		assert.doesNotMatch(all, /mapped the engine/);
		assert.match(all, /no need to poll TaskOutput/);
	});

	it("shows the report body when expanded", () => {
		const all = cardLines(details({ report: "line one\nline two" }), true, plainTheme()).join("\n");
		assert.match(all, /report:/);
		assert.match(all, /line one/);
		assert.match(all, /line two/);
		assert.doesNotMatch(all, /ctrl\+o/);
	});

	it("leads with the error, and expands the rest", () => {
		const one = cardLines(
			details({ status: "error", error: "429 rate limited", report: undefined }),
			false,
			plainTheme(),
		).join("\n");
		assert.match(one, /✗  worker/);
		assert.match(one, /ERROR in 42s/);
		assert.match(one, /429 rate limited/);
		assert.match(one, /no need to poll TaskOutput/);
		const full = cardLines(
			details({ status: "error", error: "429 rate limited\nretry later" }),
			true,
			plainTheme(),
		).join("\n");
		assert.match(full, /retry later/);
	});

	it("marks a stopped run and drops the poll hint", () => {
		const all = cardLines(details({ status: "interrupted" }), false, plainTheme()).join("\n");
		assert.match(all, /⊘  worker/);
		assert.match(all, /STOPPED in 42s/);
		assert.match(all, /stopped · no wake notice/);
		assert.doesNotMatch(all, /poll TaskOutput/);
	});

	it("says the report was already delivered", () => {
		const all = cardLines(details({ delivered: true }), false, plainTheme()).join("\n");
		assert.match(all, /already delivered by TaskOutput/);
		assert.doesNotMatch(all, /ctrl\+o/);
	});

	it("falls back when there is no report or no details", () => {
		assert.match(
			cardLines(details({ report: undefined, reportChars: 0 }), false, plainTheme()).join("\n"),
			/\(no output\)/,
		);
		assert.deepEqual(cardLines(undefined, false, plainTheme()), ["(subagent settled)"]);
	});

	it("registers a renderer that returns the card", () => {
		let seen = "";
		const pi = {
			registerMessageRenderer: (type: string, _renderer: unknown) => {
				seen = type;
			},
		};
		registerSettledCard(pi as never);
		assert.equal(seen, "pi-subagents:settled");
	});
});
