/**
 * The hard stop: a fired guard also bounds the caller's wait.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { abandonedNote, installRunBudget } from "../src/app/guards/install.ts";
import { awaitWithHardStop } from "../src/app/guards/stop.ts";

const noop = (): void => undefined;
type Deferred = { promise: Promise<void>; fire: () => void };
function deferred(): Deferred {
	let fire: () => void = noop;
	const promise = new Promise<void>((resolve) => {
		fire = resolve;
	});
	return { promise, fire };
}
describe("hard stop: a guard that fires must also bound the wait", () => {
	it("returns settled when the run finishes before any guard", async () => {
		let disposed = 0;
		const fired = deferred();
		const outcome = await awaitWithHardStop(
			{ dispose: () => (disposed += 1) },
			Promise.resolve("done"),
			{ whenFired: () => fired.promise },
			10,
		);
		assert.equal(outcome, "settled");
		assert.equal(disposed, 0);
	});

	it("waits for the clean abort inside the grace and never disposes", async () => {
		let disposed = 0;
		const fired = deferred();
		// The abort lands, the run settles 5ms later, inside a 50ms grace.
		const run = new Promise<void>((resolve) => {
			fired.promise.then(() => setTimeout(resolve, 5));
		});
		fired.fire(); // the guard speaks; the abort lands 5ms later
		const outcome = await awaitWithHardStop(
			{ dispose: () => (disposed += 1) },
			run,
			{ whenFired: () => fired.promise },
			50,
		);
		assert.equal(outcome, "settled");
		assert.equal(disposed, 0);
	});

	it("starts the grace when the guard fires, not when the run starts", async () => {
		// Regression: arming the grace timer up front made a long run
		// abandon the instant its guard fired, because the timer had
		// already expired.
		let disposed = 0;
		const fired = deferred();
		// Fire at 500ms, settle 150ms later, grace 300ms. Arming the timer
		// up front expires it at 300ms, so the buggy code abandoned at the
		// moment of the fire instead of waiting the grace.
		const run = new Promise<void>((resolve) => {
			setTimeout(resolve, 650);
		});
		setTimeout(() => fired.fire(), 500);
		const outcome = await awaitWithHardStop(
			{ dispose: () => (disposed += 1) },
			run,
			{ whenFired: () => fired.promise },
			300,
		);
		assert.equal(outcome, "settled");
		assert.equal(disposed, 0);
	});

	it("disposes a run that ignores the abort and names it in the note", async () => {
		let disposed = 0;
		const fired = deferred();
		const run = new Promise<void>(() => {
			// never settles: the exact shape of an ignored abort
		});
		fired.fire();
		const outcome = await awaitWithHardStop(
			{ dispose: () => (disposed += 1) },
			run,
			{ whenFired: () => fired.promise },
			20,
		);
		assert.equal(outcome, "abandoned");
		assert.equal(disposed, 1);
		assert.match(abandonedNote(20), /did not stop after the guard fired/);
		assert.match(abandonedNote(20), /disposed 1s later/);
	});

	it("propagates a rejection untouched instead of calling it an abandonment", async () => {
		let disposed = 0;
		const fired = deferred();
		await assert.rejects(
			awaitWithHardStop(
				{ dispose: () => (disposed += 1) },
				Promise.reject(new Error("provider died")),
				{ whenFired: () => fired.promise },
				20,
			),
			/provider died/,
		);
		assert.equal(disposed, 0);
	});

	it("a fired guard resolves whenFired exactly once and flips fired()", async () => {
		const listeners: ((e: { type: string }) => void)[] = [];
		let aborts = 0;
		const timers: { at: number; fn: () => void; dead: boolean }[] = [];
		let nowMs = 0;
		const session = {
			subscribe(l: (e: { type: string }) => void): () => void {
				listeners.push(l);
				return () => undefined;
			},
			abort: () => {
				aborts += 1;
				return Promise.resolve();
			},
		};
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
		const stop = installRunBudget(session, { timeoutSec: 30 }, clock, 0);
		assert.equal(stop.fired(), false);
		let seen = 0;
		void stop.whenFired().then(() => (seen += 1));
		nowMs += 30_000;
		for (const t of timers) {
			if (!t.dead && t.at <= nowMs) {
				t.dead = true;
				t.fn();
			}
		}
		await Promise.resolve();
		assert.equal(seen, 1);
		assert.equal(stop.fired(), true);
		assert.equal(aborts, 1);
		stop.dispose();
	});
});
