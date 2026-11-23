/**
 * The /finish start notice.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { finishNotice } from "../src/ui/view/finish-notice.ts";

const legs = [
	{ name: "code-reviewer", status: "running" as const, taskId: "task-a" },
	{ name: "planner", status: "queued" as const },
];

describe("the finish notice", () => {
	it("lists each leg with its reason", () => {
		const text = finishNotice(legs, 1, 1, [
			{ name: "code-reviewer", score: 5, rule: "review", why: 'review: "review"' },
			{ name: "planner", score: 5, rule: "plan", why: 'plan: "plan"' },
		]);
		assert.match(text, /finish · 1 started · 1 queued/);
		assert.match(text, /1\. code-reviewer — task-a · review: "review"/);
		assert.match(text, /2\. planner — queued · plan: "plan"/);
		assert.match(text, /wake you when they settle/);
	});

	it("caps the list at eight rows", () => {
		const many = Array.from({ length: 10 }, (_, i) => ({
			name: `leg-${i}`,
			status: "running" as const,
			taskId: `task-${i}`,
		}));
		const text = finishNotice(many, 10, 0, []);
		assert.match(text, /… and 2 more/);
		assert.equal(text.split("\n").filter((line) => /^\d+\./.test(line)).length, 8);
	});
});
