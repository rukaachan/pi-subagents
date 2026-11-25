/**
 * The transcript shaper: messages in, short rows out.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shapeMessages, streamText, transcriptEntries } from "../src/telemetry/live/index.ts";

function kinds(messages: unknown[]): string[] {
	return transcriptEntries(messages).map((e) => e.kind);
}

describe("transcriptEntries", () => {
	it("keeps the user's task on one line", () => {
		const [entry] = transcriptEntries([
			{ role: "user", content: "Task: map\n  the rust   engine" },
		]);
		assert.deepEqual(entry, { kind: "you", label: "you", text: "Task: map the rust engine" });
	});

	it("splits assistant text from its tool calls", () => {
		const out = transcriptEntries([
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "hidden" },
					{ type: "text", text: "Looking at the entry points." },
					{ type: "toolCall", name: "bash", arguments: { command: "ls rust/engine" } },
				],
			},
		]);
		assert.deepEqual(out, [
			{ kind: "agent", label: "agent", text: "Looking at the entry points." },
			{ kind: "tool", label: "→ bash", text: "ls rust/engine" },
		]);
	});

	it("names a tool even when the arguments have no summary", () => {
		const entries = transcriptEntries([
			{ role: "assistant", content: [{ type: "toolCall", name: "imagegen", arguments: {} }] },
		]);
		assert.equal(entries.length, 1);
		assert.equal(entries[0]?.label, "→ imagegen");
		assert.equal(entries[0]?.text, "");
	});

	it("marks a failed tool result as an error", () => {
		const out = transcriptEntries([
			{
				role: "toolResult",
				toolName: "bash",
				isError: true,
				content: [{ type: "text", text: "exit 1: no such file" }],
			},
		]);
		assert.deepEqual(out, [{ kind: "error", label: "← bash", text: "exit 1: no such file" }]);
	});

	it("shows an assistant failure too", () => {
		const out = transcriptEntries([
			{
				role: "assistant",
				content: [{ type: "text", text: "half an answer" }],
				stopReason: "error",
				errorMessage: "529 overloaded",
			},
		]);
		assert.deepEqual(
			out.map((e) => [e.kind, e.text]),
			[
				["agent", "half an answer"],
				["error", "529 overloaded"],
			],
		);
	});

	it("hides the system prompt", () => {
		assert.deepEqual(kinds([{ role: "system", content: "you are a subagent" }]), []);
	});

	it("keeps the last 400 entries and says what it cut", () => {
		const many = Array.from({ length: 401 }, (_, i) => ({
			role: "user",
			content: `step ${i}`,
		}));
		const out = transcriptEntries(many);
		assert.equal(out.length, 401);
		assert.equal(out[0]?.kind, "result");
		assert.equal(out[0]?.text, "1 earlier entries hidden");
		assert.equal(out[1]?.text, "step 1");
		assert.equal(out.at(-1)?.text, "step 400");
	});

	it("survives garbage", () => {
		assert.deepEqual(transcriptEntries([null, 3, "x", {}, { role: "nope" }]), []);
	});

	it("full mode keeps newlines and long bodies", () => {
		const long = "x".repeat(9000);
		const out = transcriptEntries(
			[
				{
					role: "toolResult",
					toolName: "bash",
					content: [{ type: "text", text: "a\nb\nc" }],
				},
				{ role: "assistant", content: [{ type: "text", text: long }] },
			],
			{ full: true },
		);
		assert.equal(out[0]?.text, "a\nb\nc");
		assert.equal(out[1]?.text.length, 8000);
		assert.ok(out[1]?.text.endsWith("…"));
	});

	it("trims the oldest entries to fit a text budget", () => {
		const many = Array.from({ length: 10 }, (_, i) => ({
			role: "user",
			content: `${"u".repeat(100)}${i}`,
		}));
		const out = transcriptEntries(many, { textBudget: 350 });
		assert.equal(out.length, 4);
		assert.equal(out[0]?.text, "7 earlier entries hidden");
		assert.equal(out.at(-1)?.text?.length, 101);
	});

	it("shapeMessages never caps or adds a head row", () => {
		const many = Array.from({ length: 401 }, (_, i) => ({ role: "user", content: `step ${i}` }));
		assert.equal(shapeMessages(many).length, 401);
	});

	it("streamText keeps only assistant text, tail-clipped", () => {
		assert.equal(
			streamText({ role: "assistant", content: [{ type: "text", text: "hello" }] }),
			"hello",
		);
		assert.equal(
			streamText({
				role: "assistant",
				content: [{ type: "toolCall", name: "bash", arguments: {} }],
			}),
			"",
		);
		const text = streamText({
			role: "assistant",
			content: [{ type: "text", text: "x".repeat(5000) }],
		});
		assert.equal(text.length, 4001);
		assert.ok(text.startsWith("…"));
	});
});
