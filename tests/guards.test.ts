/**
 * Budget overrides and the guard timers that must not claim a stop.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { installRunBudget } from "../src/app/guards/install.ts";
import {
	DEFAULT_TIMEOUT_SEC,
	effectiveBudget,
	parseBudget,
} from "../src/domain/subagent/budget.ts";
import { applyRunOverrides } from "../src/domain/tiers.ts";

const WORKER = {
	name: "worker",
	description: "",
	model: "inherit",
	autonomy: "inherit",
	systemPrompt: "",
	source: "user",
	filePath: "subagents/worker.md",
	warnings: [],
	budget: { maxTurns: 0, maxInputTokens: 0, timeoutSec: 5400, maxReportChars: 6000 },
} as never;
describe("budget overrides keep what they do not name", () => {
	it("a partial per-run budget keeps the file timeout", () => {
		const asked = parseBudget({ maxReportChars: 12000 });
		assert.deepEqual(asked, { maxReportChars: 12000 });
		const derived = applyRunOverrides(WORKER, { budget: asked as never });
		assert.deepEqual(derived.budget, {
			maxTurns: 0,
			maxInputTokens: 0,
			timeoutSec: 5400,
			maxReportChars: 12000,
		});
		assert.equal(effectiveBudget(derived.budget).timeoutSec, 5400);
	});

	it("a per-run cap can still be lowered and switched off with 0", () => {
		const lower = applyRunOverrides(WORKER, { budget: { timeoutSec: 60 } as never });
		assert.equal(lower.budget?.timeoutSec, 60);
		const off = applyRunOverrides(WORKER, { budget: { timeoutSec: 0 } as never });
		assert.equal(off.budget?.timeoutSec, 0);
		assert.equal(effectiveBudget(off.budget).timeoutSec, 0, "an explicit 0 is off, not a default");
	});

	it("`{ }` still clears every cap, and it now survives the parse", () => {
		assert.deepEqual(parseBudget({}), {});
		const cleared = applyRunOverrides(WORKER, { budget: parseBudget({}) as never });
		assert.deepEqual(cleared.budget, {});
		assert.deepEqual(parseBudget(undefined), undefined);
		assert.equal(effectiveBudget(undefined).timeoutSec, DEFAULT_TIMEOUT_SEC);
	});
});
describe("guard timers cannot claim what did not happen", () => {
	type Listener = (event: { type: string }) => void;

	function rig(opts: { idle: boolean }) {
		const listeners: Listener[] = [];
		const aborts: string[] = [];
		const timers: { at: number; fn: () => void; dead: boolean }[] = [];
		let nowMs = 0;
		let unsubscribed = 0;
		const session = {
			isIdle: opts.idle,
			subscribe(listener: Listener): () => void {
				listeners.push(listener);
				return () => {
					unsubscribed += 1;
				};
			},
			abort(): Promise<void> {
				aborts.push("abort");
				return Promise.resolve();
			},
		};
		return {
			session,
			aborts,
			unsubscribed: () => unsubscribed,
			clock: {
				now: () => nowMs,
				schedule(fn: () => void, ms: number) {
					const t = { at: nowMs + ms, fn, dead: false };
					timers.push(t);
					return () => {
						t.dead = true;
					};
				},
			},
			tick(secs: number) {
				nowMs += secs * 1000;
				for (const t of timers) {
					if (!t.dead && t.at <= nowMs) {
						t.dead = true;
						t.fn();
					}
				}
			},
			event(type = "message_update") {
				for (const l of listeners) l({ type });
			},
		};
	}

	it("a timeout that fires after the run settled claims nothing", () => {
		const r = rig({ idle: true });
		const stop = installRunBudget(r.session, { timeoutSec: 60 }, r.clock, 0);
		r.tick(60);
		assert.deepEqual(r.aborts, [], "an idle session is not aborted");
		assert.equal(stop.spent(), false);
		assert.equal(stop.note(), null);
		stop.dispose();
	});

	it("a stall that fires after the run settled claims nothing either", () => {
		const r = rig({ idle: true });
		const stop = installRunBudget(r.session, {}, r.clock, 10);
		r.tick(10);
		assert.deepEqual(r.aborts, []);
		assert.equal(stop.spent(), false);
		stop.dispose();
	});

	it("dispose drops the session listener", () => {
		const r = rig({ idle: false });
		const stop = installRunBudget(r.session, { timeoutSec: 60 }, r.clock, 0);
		assert.equal(r.unsubscribed(), 0);
		stop.dispose();
		assert.equal(r.unsubscribed(), 1);
	});

	it("the note names the moment the guard fired, not the read", () => {
		const r = rig({ idle: false });
		const stop = installRunBudget(r.session, {}, r.clock, 10);
		r.tick(10);
		assert.deepEqual(r.aborts, ["abort"]);
		r.tick(500); // the caller reads the note much later
		assert.match(stop.note() ?? "", /aborted at 10s/);
		stop.dispose();
	});
});
