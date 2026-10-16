/**
 * installRunBudget: the timeout guards, turn and token caps opt-in.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { installRunBudget } from "../src/app/guards/install.ts";

describe("installRunBudget: the timeout guards, turn/token caps stay opt-in", () => {
	type Listener = (event: { type: string; message?: { usage?: Record<string, number> } }) => void;

	function bench() {
		const listeners: Listener[] = [];
		const aborts: number[] = [];
		let nowMs = 1_000;
		let armed: (() => void) | null = null;
		return {
			clock: {
				now: () => nowMs,
				schedule(fn: () => void, ms: number) {
					void ms;
					armed = fn;
					return () => {
						armed = null;
					};
				},
			},
			session: {
				subscribe(listener: Listener): () => void {
					listeners.push(listener);
					return () => undefined;
				},
				abort(): void {
					aborts.push(aborts.length + 1);
				},
			},
			aborts,
			fire: () => listeners[0]?.({ type: "turn_end" }),
			fireUsage: (usage: Record<string, number>) =>
				listeners[0]?.({ type: "turn_end", message: { usage } }),
			advance: (secs: number) => {
				nowMs += secs * 1000;
			},
			timer: () => armed,
		};
	}

	it("arms no timer when no timeout is set", () => {
		const b = bench();
		const stop = installRunBudget(b.session, undefined, b.clock, 0);
		assert.equal(b.timer(), null, "no deadline, no timer");
		assert.equal(stop.spent(), false);
		assert.equal(stop.note(), null);
		stop.dispose();
	});

	it("aborts on the wall clock and names the timeout", () => {
		const b = bench();
		const stop = installRunBudget(b.session, { timeoutSec: 600 }, b.clock, 0);
		assert.notEqual(b.timer(), null, "a deadline arms the timer");
		b.advance(600);
		b.timer()?.();
		assert.deepEqual(b.aborts, [1], "the timer aborts the run");
		assert.equal(stop.spent(), true);
		assert.equal(stop.note(), "timeout 600s reached: the run was aborted after 600s.");
		stop.dispose();
	});

	it("holds the deadline when the timer is late: turn_end re-checks the clock", () => {
		const b = bench();
		const stop = installRunBudget(b.session, { timeoutSec: 60 }, b.clock, 0);
		b.advance(61);
		b.fire(); // no timer fire: the boundary catches the overdue clock
		assert.deepEqual(b.aborts, [1]);
		assert.match(stop.note() ?? "", /timeout 60s reached: the run was aborted after 61s\./);
		stop.dispose();
	});

	it("a late timer after dispose cannot abort a finished run", () => {
		const b = bench();
		const stop = installRunBudget(b.session, { timeoutSec: 30 }, b.clock, 0);
		const armed = b.timer();
		stop.dispose();
		armed?.(); // a driver that kept the callback
		assert.deepEqual(b.aborts, []);
		assert.equal(stop.spent(), false, "a finished run is not marked cut");
	});

	it("maxTurns 0 / maxInputTokens 0 mean off, never 'zero allowed'", () => {
		const b = bench();
		const stop = installRunBudget(
			b.session,
			{ maxTurns: 0, maxInputTokens: 0, timeoutSec: 0 },
			b.clock,
		);
		for (let i = 0; i < 40; i++) b.fire();
		assert.deepEqual(b.aborts, [], "40 turns, no abort: 0 = unlimited");
		assert.equal(stop.spent(), false);
		assert.equal(stop.note(), null);
		stop.dispose();
	});

	it("keeps the turn cap for paid lanes that ask for one", () => {
		const b = bench();
		const stop = installRunBudget(b.session, { maxTurns: 2, timeoutSec: 600 }, b.clock);
		b.fire();
		assert.deepEqual(b.aborts, [], "the first turn is not the ceiling");
		b.fire();
		assert.deepEqual(b.aborts, [1], "abort fires exactly at the ceiling");
		assert.equal(stop.note(), "turn budget 2 reached: run stopped after 2 turns.");
		stop.dispose();
	});

	it("keeps the token cap and counts cached prompt tokens", () => {
		const b = bench();
		const stop = installRunBudget(b.session, { maxInputTokens: 200_000 }, b.clock, 0);
		b.fire(); // no usage reported
		assert.equal(stop.spent(), false);
		assert.match(
			stop.note() ?? "",
			/input budget 200000 idle: the provider reported no usage in 1 turn\./,
		);
		// One recorded turn exactly as pi-ai reported it (session
		// 2026-10-18T00-43-35): input 76,379 while the prompt really sent
		// was 368,603 tokens. Reading `input` alone sees 21% of it.
		const c = bench();
		const counted = installRunBudget(c.session, { maxInputTokens: 200_000 }, c.clock, 0);
		c.fireUsage({ input: 76_379, cacheRead: 292_224 });
		assert.equal(counted.spent(), true, "a recorded 368,603-token prompt passes a 200k cap");
		assert.match(counted.note() ?? "", /after 368,603 prompt tokens/);
		stop.dispose();
		counted.dispose();
	});

	it("reports every cap that tripped", () => {
		const b = bench();
		const stop = installRunBudget(b.session, { maxTurns: 1, maxInputTokens: 100 }, b.clock);
		b.fireUsage({ input: 500 });
		assert.equal(stop.spent(), true);
		const note = stop.note() ?? "";
		assert.match(note, /turn budget 1 reached/);
		assert.match(note, /input budget 100 reached/);
		stop.dispose();
	});
});
