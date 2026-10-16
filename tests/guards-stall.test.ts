/**
 * The stall watchdog and the per-run budget opt-out.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type SubagentConfig } from "../src/domain/subagent/config.ts";
import { installRunBudget } from "../src/app/guards/install.ts";

describe("stall watchdog: silence is the failure, not slowness", () => {
	type Listener = (event: { type: string }) => void;

	function rig() {
		const listeners: Listener[] = [];
		const aborts: number[] = [];
		const timers: { at: number; fn: () => void; dead: boolean }[] = [];
		let nowMs = 0;
		const clock = {
			now: () => nowMs,
			schedule(fn: () => void, ms: number) {
				const t = { at: nowMs + ms, fn, dead: false };
				timers.push(t);
				return () => {
					t.dead = true;
				};
			},
		};
		const harness = {
			subscribe(listener: Listener): () => void {
				listeners.push(listener);
				return () => undefined;
			},
			abort(): void {
				aborts.push(aborts.length + 1);
			},
		};
		return {
			clock,
			session: harness,
			aborts,
			event: (type = "message_update") => listeners[0]?.({ type }),
			tick: (secs: number) => {
				nowMs += secs * 1000;
				for (const t of timers) {
					if (!t.dead && t.at <= nowMs) {
						t.dead = true;
						t.fn();
					}
				}
			},
		};
	}

	it("does not abort a slow run that keeps talking", () => {
		const r = rig();
		const stop = installRunBudget(r.session, { timeoutSec: 5400 }, r.clock);
		for (let i = 0; i < 8; i++) {
			r.event();
			r.tick(60);
		}
		assert.deepEqual(r.aborts, [], "progress keeps the watchdog asleep");
		assert.equal(stop.spent(), false);
		stop.dispose();
	});

	it("aborts a run that goes silent, before the total timeout", () => {
		const r = rig();
		const stop = installRunBudget(r.session, { timeoutSec: 5400 }, r.clock);
		r.event();
		r.tick(899);
		assert.deepEqual(r.aborts, [], "899s of silence is still allowed");
		r.tick(1); // the stall timer is due at 900s
		assert.deepEqual(r.aborts, [1], "silence past the floor aborts");
		assert.equal(stop.spent(), true);
		assert.match(stop.note() ?? "", /stalled: no session event in 900s/);
		stop.dispose();
	});

	it("holds even under an explicit budget: { } — liveness is not a cap", () => {
		const r = rig();
		const stop = installRunBudget(r.session, {}, r.clock);
		r.tick(900);
		assert.deepEqual(r.aborts, [1]);
		assert.match(stop.note() ?? "", /stalled:/);
		stop.dispose();
	});

	it("any event type counts as progress, not just turn_end", () => {
		const r = rig();
		const stop = installRunBudget(r.session, {}, r.clock);
		for (const type of ["message_start", "tool_start", "tool_end", "message_update"]) {
			r.event(type);
			r.tick(600);
		}
		assert.deepEqual(r.aborts, [], "tool and delta events reset the floor");
		stop.dispose();
	});

	it("a disposed watchdog never fires", () => {
		const r = rig();
		const stop = installRunBudget(r.session, {}, r.clock);
		stop.dispose();
		r.tick(5000);
		assert.deepEqual(r.aborts, []);
		assert.equal(stop.spent(), false);
	});

	it("the constant is the measured 900s", async () => {
		const { STALL_SEC } = await import("../src/app/guards/install.ts");
		assert.equal(STALL_SEC, 900);
	});
});
describe("Task-level budget opt-out (v0.13.4)", () => {
	it("applyRunOverrides merges a per-run budget and the note shows caps", async () => {
		const { applyRunOverrides, overrideNote } = await import("../src/domain/tiers.ts");
		const base: SubagentConfig = {
			name: "x",
			description: "",
			model: "inherit",
			autonomy: "low",
			systemPrompt: "",
			source: "user",
			filePath: "/x.md",
			warnings: [],
		};
		const merged = applyRunOverrides(base, { budget: { maxTurns: 5, maxReportChars: 800 } });
		assert.deepEqual(merged.budget, { maxTurns: 5, maxReportChars: 800 });
		assert.match(
			overrideNote({ budget: { maxTurns: 5, maxReportChars: 800 } } as never),
			/budget 5 turns \/ 800 chars/,
		);
		const cleared = applyRunOverrides({ ...base, budget: { maxTurns: 4 } } as never, {
			budget: {},
		});
		assert.deepEqual(cleared.budget, {});
		assert.match(overrideNote({ budget: {} } as never), /budget none/);
	});

	it("parseBudget rejects unknown Task-level keys and non-integers", async () => {
		const { parseBudget } = await import("../src/domain/subagent/budget.ts");
		assert.match(parseBudget({ maxTurn: 5 }) as string, /unknown budget field "maxTurn"/);
		assert.match(parseBudget({ maxTurns: 2.5 }) as string, /invalid budget/);
		// `{ }` is the documented opt-out and must survive the wire; it
		// used to come back undefined, so the override was dropped and the
		// starter's 5,400s timeout stayed on.
		assert.deepEqual(parseBudget({}), {});
		assert.equal(parseBudget(undefined), undefined);
	});
});
