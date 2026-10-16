/**
 * Every live child session answers one stop request.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
	liveCount,
	liveLabels,
	liveStop,
	registerLive,
	stopLiveRuns,
} from "../src/app/live-runs.ts";
import { RunStopped, isRunStopped, stoppedToolText } from "../src/domain/run-stop.ts";

function fakeSession() {
	const calls: string[] = [];
	return {
		calls,
		abort() {
			calls.push("abort");
		},
		dispose() {
			calls.push("dispose");
		},
	};
}

beforeEach(() => {
	stopLiveRuns("reset");
});

describe("the live run registry", () => {
	it("stops every registered run and says which ones", () => {
		const a = fakeSession();
		const b = fakeSession();
		registerLive("a", "worker a", () => {
			a.abort();
			a.dispose();
		});
		registerLive("b", "explorer b", () => {
			b.abort();
			b.dispose();
		});
		assert.equal(liveCount(), 2);
		const stopped = stopLiveRuns("Esc");
		assert.deepEqual(stopped, ["worker a", "explorer b"]);
		assert.deepEqual(a.calls, ["abort", "dispose"]);
		assert.deepEqual(b.calls, ["abort", "dispose"]);
		assert.equal(liveCount(), 0, "the registry is empty after a stop");
	});

	it("unregisters without stopping, so a finished run is left alone", () => {
		const a = fakeSession();
		const unregister = registerLive("a", "worker a", () => a.abort());
		unregister();
		unregister();
		assert.deepEqual(stopLiveRuns("Esc"), []);
		assert.deepEqual(a.calls, []);
	});

	it("keeps stopping the rest when one run throws", () => {
		const ok = fakeSession();
		registerLive("bad", "wedged", () => {
			throw new Error("no");
		});
		registerLive("good", "worker", () => {
			ok.abort();
			ok.dispose();
		});
		const stopped = stopLiveRuns("quit");
		assert.deepEqual(stopped, ["worker"], "the wedge is not reported as stopped");
		assert.deepEqual(ok.calls, ["abort", "dispose"]);
	});

	it("books a run once even when two stop paths race", () => {
		const why: string[] = [];
		const session = fakeSession();
		const live = liveStop("t1", "worker", session, (reason) => why.push(reason));
		const first = live.stop("Esc");
		const second = live.stop("quit");
		stopLiveRuns("reload");
		assert.deepEqual(why, ["Esc"], "only the first request books");
		assert.equal(live.wasStopped(), true);
		assert.equal(live.why(), "Esc");
		assert.equal(first, undefined);
		assert.equal(second, undefined);
		assert.deepEqual(session.calls, ["abort", "dispose"], "abort/dispose happen once");
		assert.deepEqual(liveLabels(), [], "stopLiveRuns saw it already stopped");
	});

	it("books before it aborts, so a hung abort still leaves a trail", () => {
		const order: string[] = [];
		liveStop(
			"t2",
			"worker",
			{
				abort() {
					order.push("abort");
				},
				dispose() {
					order.push("dispose");
				},
			},
			() => order.push("book"),
		);
		stopLiveRuns("Esc");
		assert.deepEqual(order, ["book", "abort", "dispose"]);
	});

	it("survives a session that is already disposed", () => {
		const live = liveStop(
			"t3",
			"worker",
			{
				abort() {
					throw new Error("gone");
				},
				dispose() {
					throw new Error("gone");
				},
			},
			() => {},
		);
		assert.doesNotThrow(() => live.stop("Esc"));
		assert.equal(live.wasStopped(), true);
	});
});

describe("the stopped run error", () => {
	it("names the trigger and is recognisable", () => {
		const err = new RunStopped("Esc");
		assert.equal(err.message, "stopped: interrupted by Esc");
		assert.equal(isRunStopped(err), true);
		assert.equal(isRunStopped(new Error("boom")), false);
	});

	it("tells the caller the row is gone", () => {
		const text = stoppedToolText("worker", "reload");
		assert.match(text, /Subagent "worker" stopped: interrupted by reload\./);
		assert.match(text, /Its row was removed\./);
	});
});
