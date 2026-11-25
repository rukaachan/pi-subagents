import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resumeContext, resumePrompt, RESUME_CONTEXT_CHARS } from "../src/app/retry/index.ts";

function user(text: string) {
	return { role: "user", content: text };
}

function agent(text: string) {
	return { role: "assistant", content: [{ type: "text", text }] };
}

function tool(entries: number, body: string) {
	return {
		role: "toolResult",
		toolName: "bash",
		isError: false,
		content: Array.from({ length: entries }, () => ({ type: "text", text: body })),
	};
}

describe("resume context", () => {
	it("says so when there is no history", () => {
		assert.equal(resumeContext([]), "(no prior turns)");
		assert.equal(resumeContext([{ role: "system", content: "s" }]), "(no prior turns)");
	});

	it("reads like a transcript, not a JSON dump", () => {
		const text = resumeContext([user("Task: map auth"), agent("auth lives in src/auth.ts")]);
		assert.match(text, /you\s+Task: map auth/);
		assert.match(text, /agent\s+auth lives in src\/auth\.ts/);
		assert.doesNotMatch(text, /\{"role"/);
		assert.doesNotMatch(text, /\[object Object\]/);
	});

	it("labels tool results, including errors", () => {
		const ok = resumeContext([tool(1, "engine\norderbook")]);
		assert.match(ok, /← bash\s+engine/);
		const bad = resumeContext([
			{
				role: "toolResult",
				toolName: "bash",
				isError: true,
				content: [{ type: "text", text: "cargo: command not found" }],
			},
		]);
		assert.match(bad, /← bash \(error\)\s+cargo: command not found/);
	});

	it("keeps the newest entries and counts the hidden ones", () => {
		const history = Array.from({ length: 40 }, (_, i) => user(`step ${i} ${"x".repeat(190)}`));
		const text = resumeContext(history, 1200);
		assert.match(text, /^… \d+ earlier entries hidden/);
		assert.match(text, /step 39/);
		assert.doesNotMatch(text, /step 0 /);
		assert.ok(text.length <= 1200 + 120, `kept ${text.length} chars`);
		// Every kept entry is whole: the tail of one entry is never a cut word.
		for (const block of text.split("\n\n").slice(1)) {
			assert.match(block, /^you\s+step \d+ x+$/, block.slice(0, 40));
		}
	});

	it("keeps a single huge entry rather than dropping everything", () => {
		const text = resumeContext([user("y".repeat(5000))], 1000);
		assert.match(text, /^you\s+yyyy/);
		assert.ok(text.length > 1000);
	});

	it("builds the exact follow-up prompt", () => {
		const text = resumePrompt([user("Task: map auth")], "now add tests");
		assert.match(text, /^Prior context \(bounded, newest kept\):\nyou\s+Task: map auth/);
		assert.match(text, /\n\nFollow-up task: now add tests$/);
		assert.doesNotMatch(text, /\{"role"/);
	});

	it("stays under the real budget on a realistic history", () => {
		const history = Array.from({ length: 60 }, (_, i) =>
			i % 2 === 0 ? user(`turn ${i} ${"a".repeat(300)}`) : agent(`answer ${i} ${"b".repeat(300)}`),
		);
		const text = resumeContext(history);
		assert.ok(text.length <= RESUME_CONTEXT_CHARS + 200, `kept ${text.length} chars`);
		assert.match(text, /turn 58|answer 58/);
		assert.match(text, /answer 59/);
	});
});
