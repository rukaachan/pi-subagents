/**
 * The report a finished run hands back, and the notes it keeps.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { anyAssistantText } from "../src/domain/run-result.ts";
import { runReport } from "../src/domain/run-report.ts";

type Session = Parameters<typeof runReport>[0];
const session = (messages: Msg[], last?: string): Session =>
	({ getLastAssistantText: () => last, messages }) as unknown as Session;
const call = (name: string): Msg => ({
	role: "assistant",
	content: [{ type: "toolCall", name, arguments: {} }],
});
const text = (t: string): Msg => ({ role: "assistant", content: [{ type: "text", text: t }] });
type Msg = { role: string; content: unknown[] };
describe("run report: the first line tells how the run ended", () => {
	it("returns a closing answer untouched", async () => {
		const answer = "All 124 Go files were read.\n\n| # | File | Lines |";
		assert.equal(
			runReport(session([text("hi"), text(answer)], answer), { stopNote: null, steps: [] }),
			answer,
		);
	});

	it("keeps a stopped run's answer and marks it as cut", async () => {
		const answer = "All 124 Go files were read.";
		const report = runReport(session([text(answer)], answer), {
			stopNote: "turn budget 3 reached: run stopped after 3 turns.",
			steps: [{ tool: "bash", detail: "wc -l internal/zen/*.go" }],
		});
		// Measured live: wrapping a 6,086-char answer in a cut report left 791.
		assert.ok(report.endsWith(answer), "the answer survives whole");
		assert.match(report, /^\[cut short\] turn budget 3 reached: run stopped after 3 turns\./);
	});

	it("marks turn-1 chatter when the run ended on a tool call", async () => {
		const messages: Msg[] = [{ role: "user", content: [{ type: "text", text: "task" }] }];
		for (let i = 0; i < 26; i += 1) {
			messages.push(i === 0 ? text("I'll start by reading the target file.") : call("codemode"));
			messages.push({ role: "toolResult", content: [{ type: "text", text: "ok" }] });
		}
		const report = runReport(session(messages), { stopNote: null, steps: [] });
		assert.match(report, /^\[incomplete\] the run ended on a tool call/);
		assert.match(report, /I'll start by reading the target file\./);
		const cut = runReport(session(messages), {
			stopNote: "turn budget 25 reached: run stopped after 26 turns.",
			steps: [{ tool: "codemode", detail: "script" }],
		});
		assert.match(cut, /^\[cut short\] turn budget 25 reached: run stopped after 26 turns\./);
		assert.match(cut, /Last steps:\n- codemode · script/);
	});

	it("stands in for a run that never spoke", async () => {
		const silent = session([
			{ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: {} }] },
		]);
		const cut = runReport(silent, {
			stopNote:
				"input budget 10 reached: run stopped after 12,000 prompt tokens (cached reads included).",
			steps: [
				{ tool: "write", detail: "tests/rule_oracle_parity.rs" },
				{ tool: "bash", detail: "cargo test -p trade_plan --test rule_oracle_parity" },
			],
		});
		assert.match(cut, /^\[cut short\] input budget 10 reached/);
		assert.match(cut, /Last steps:\n- write · tests\/rule_oracle_parity\.rs\n- bash · cargo test/);
		assert.doesNotMatch(cut, /no output/);
		assert.equal(runReport(silent, { stopNote: null, steps: [] }), "(no output)");
	});

	it("finds the newest words past a textless tail", async () => {
		const messages: Msg[] = [
			{ role: "assistant", content: [{ type: "text", text: "first words" }] },
			{ role: "assistant", content: [{ type: "text", text: "second words" }] },
			call("bash"),
		];
		assert.equal(anyAssistantText(session(messages)), "second words");
		assert.equal(anyAssistantText(session(messages, "final words")), "final words");
	});
});
describe("failed run: history kept for resume", () => {
	it("copies the messages, sets status and error, and detaches the copy", async () => {
		const { recordFailure } = await import("../src/domain/run-result.ts");
		const messages = [{ role: "user", content: [{ type: "text", text: "task" }] }];
		type FailSession = Parameters<typeof recordFailure>[1];
		const live = { messages } as unknown as FailSession;
		const target: {
			history: unknown[];
			status: "done" | "running" | "pending" | "error";
			error?: string;
		} = { history: [], status: "running" };

		const message = recordFailure(target, live, new Error("stream ended: 400 Bad Request"));
		assert.equal(message, "stream ended: 400 Bad Request");
		assert.equal(target.status, "error");
		assert.equal(target.error, "stream ended: 400 Bad Request");
		assert.equal(target.history.length, 1, "a run that dies at turn 45 stays resumable");
		assert.notEqual(target.history[0], messages[0], "the copy is detached from the live session");
		// Non-Error throws still produce a message.
		assert.equal(recordFailure(target, live, "plain string"), "plain string");
		// A session that cannot be serialized yields an empty history, not a throw.
		const bad = {
			messages: {
				toJSON() {
					throw new Error("cyclic");
				},
			},
		} as unknown as FailSession;
		assert.equal(recordFailure(target, bad, new Error("x")), "x");
		assert.deepEqual(target.history, []);
	});
});
describe("budget notes surface even when the budget did not fire", () => {
	it("pushes the idle note and returns no cut marker", async () => {
		const { surfaceBudgetNotes } = await import("../src/app/guards/stop.ts");
		const notes: string[] = [];
		const idle = {
			spent: () => false,
			note: () => "input budget 120000 idle: the provider reported no usage in 4 turns.",
		};
		const stopNote = surfaceBudgetNotes(notes, idle);
		assert.deepEqual(notes, [
			"input budget 120000 idle: the provider reported no usage in 4 turns.",
		]);
		assert.equal(stopNote, null, "an unspent budget must not mark the report as cut");
	});

	it("returns the note as the cut marker when the budget fired", async () => {
		const { surfaceBudgetNotes } = await import("../src/app/guards/stop.ts");
		const notes: string[] = [];
		const fired = {
			spent: () => true,
			note: () => "turn budget 25 reached: run stopped after 26 turns.",
		};
		const stopNote = surfaceBudgetNotes(notes, fired);
		assert.deepEqual(notes, ["turn budget 25 reached: run stopped after 26 turns."]);
		assert.equal(stopNote, "turn budget 25 reached: run stopped after 26 turns.");
	});

	it("does nothing when there is no note", async () => {
		const { surfaceBudgetNotes } = await import("../src/app/guards/stop.ts");
		const notes: string[] = [];
		assert.equal(surfaceBudgetNotes(notes, { spent: () => false, note: () => null }), null);
		assert.deepEqual(notes, []);
	});
});
