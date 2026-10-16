/**
 * The wind-down request and the note a failure keeps.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { installRunBudget } from "../src/app/guards/install.ts";
import { annotateFailure } from "../src/app/guards/stop.ts";
import {
	WIND_DOWN_SEC,
	windDownNote,
	windDownPrompt,
	windDownSignal,
} from "../src/app/guards/wind.ts";

describe("wind-down: ask for a summary before the axe falls", () => {
	type Listener = (event: { type: string }) => void;

	function rig() {
		const listeners: Listener[] = [];
		const aborts: string[] = [];
		const timers: { at: number; fn: () => void; dead: boolean }[] = [];
		let nowMs = 0;
		const session = {
			subscribe(l: Listener): () => void {
				listeners.push(l);
				return () => undefined;
			},
			abort: () => {
				aborts.push("abort");
				return Promise.resolve();
			},
			steer: (text: string) => {
				steered.push(text);
				return Promise.resolve("queued" as const);
			},
		};
		const steered: string[] = [];
		return {
			session,
			aborts,
			steered,
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
		};
	}

	it("fires one wind-down a fixed distance before the timeout, not an abort", () => {
		const r = rig();
		const seen: number[] = [];
		const stop = installRunBudget(r.session, { timeoutSec: 3600 }, r.clock, 0);
		stop.windDown((left) => seen.push(left));
		r.tick(3299);
		assert.deepEqual(seen, [], "nothing yet at 3,299s");
		r.tick(1);
		assert.deepEqual(seen, [WIND_DOWN_SEC], "asked at 3,300s with 300s left");
		assert.deepEqual(r.aborts, [], "a request is not a stop");
		r.tick(300);
		assert.deepEqual(r.aborts, ["abort"], "the timeout still fires at 3,600s");
		stop.dispose();
	});

	it("stays silent on runs too short to afford a wrap-up turn", () => {
		for (const timeoutSec of [60, 600, 899]) {
			const r = rig();
			const seen: number[] = [];
			const stop = installRunBudget(r.session, { timeoutSec }, r.clock, 0);
			stop.windDown((left) => seen.push(left));
			r.tick(timeoutSec);
			assert.deepEqual(seen, [], `${timeoutSec}s has no wrap-up window`);
			stop.dispose();
		}
	});

	it("arms at exactly three wind-downs (900s)", () => {
		const r = rig();
		const seen: number[] = [];
		const stop = installRunBudget(r.session, { timeoutSec: 900 }, r.clock, 0);
		stop.windDown((left) => seen.push(left));
		r.tick(600);
		assert.deepEqual(seen, [WIND_DOWN_SEC]);
		stop.dispose();
	});

	it("dispose cancels a wind-down that has not fired", () => {
		const r = rig();
		const seen: number[] = [];
		const stop = installRunBudget(r.session, { timeoutSec: 3600 }, r.clock, 0);
		stop.windDown((left) => seen.push(left));
		stop.dispose();
		r.tick(3600);
		assert.deepEqual(seen, []);
		assert.deepEqual(r.aborts, []);
	});

	it("the message tells the child to stop working and report state", () => {
		const text = windDownPrompt(300);
		assert.match(text, /about 300 seconds remain/);
		assert.match(text, /Stop starting new work/);
		assert.match(text, /what you finished/);
		assert.match(text, /exact state the caller needs to continue/);
	});

	it("queues the wrap-up through steer and notes it only once delivered", async () => {
		const notes: string[] = [];
		const sent: string[] = [];
		await windDownSignal(
			{
				steer: (text: string) => {
					sent.push(text);
					return Promise.resolve("queued");
				},
			},
			notes,
			300,
		);
		assert.equal(sent.length, 1);
		assert.match(sent[0] ?? "", /Time check from the caller/);
		assert.deepEqual(notes, [windDownNote(300)]);

		const quiet: string[] = [];
		await windDownSignal(
			{
				steer: () => Promise.reject(new Error("not streaming")),
			},
			quiet,
			300,
		);
		assert.deepEqual(quiet, [], "a failed request claims nothing");
	});
});
describe("annotateFailure keeps the reason on the rejecting path", () => {
	it("appends the guard note to the error message", () => {
		const why = annotateFailure(new Error("aborted"), "stalled: no session event in 900s");
		assert.ok(why instanceof Error);
		assert.equal(why.message, "aborted (stalled: no session event in 900s)");
	});

	it("returns the original error untouched when there is no note", () => {
		const original = new Error("boom");
		assert.equal(annotateFailure(original, null), original);
		assert.equal((annotateFailure("plain", null) as string) === "plain", true);
	});

	it("stringifies a non-Error failure before appending", () => {
		assert.equal((annotateFailure("plain", "timeout 60s") as Error).message, "plain (timeout 60s)");
	});
});
