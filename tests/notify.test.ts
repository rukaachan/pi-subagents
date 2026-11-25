import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	clearNotifySink,
	notifySettled,
	setNotifySink,
	settleMessage,
} from "../src/telemetry/notify/index.ts";
import type { SettleNotice } from "../src/telemetry/notify/index.ts";

const base: SettleNotice = {
	taskId: "task_abc123",
	subagent: "explorer",
	status: "done",
	elapsedMs: 42_400,
	turns: 3,
	tokens: 8_120,
	cost: 0.003,
	report: "Found the auth module.",
	delivered: true,
};

describe("settle message", () => {
	it("carries the report and the numbers", () => {
		const { content, details } = settleMessage(base);
		assert.match(
			content,
			/^\[subagent settled\] explorer · task_abc123 · DONE in 42s · 3 turns · 8\.1k tok · \$0\.003/,
		);
		assert.match(content, /Report:\nFound the auth module\./);
		assert.match(content, /Do not poll TaskOutput/);
		assert.equal(details.reportChars, 22);
		assert.equal(details.delivered, true);
	});

	it("says the report was already delivered", () => {
		const { content, details } = settleMessage({ ...base, report: undefined, delivered: false });
		assert.match(content, /already delivered by TaskOutput/);
		assert.doesNotMatch(content, /Report:/);
		assert.equal(details.delivered, false);
	});

	it("renders an error without a report", () => {
		const { content } = settleMessage({
			...base,
			status: "error",
			report: undefined,
			error: "429 Too Many Requests",
			delivered: false,
		});
		assert.match(content, /ERROR in 42s/);
		assert.match(content, /Error: 429 Too Many Requests/);
		assert.match(content, /The run is over/);
	});

	it("handles a sub-cent cost and a million tokens", () => {
		const { content } = settleMessage({ ...base, cost: 0.0004, tokens: 1_250_000 });
		assert.match(content, /1\.3M tok/);
		assert.match(content, /<\$0\.001/);
	});

	it("omits zero numbers", () => {
		const { content } = settleMessage({ ...base, turns: 0, tokens: 0, cost: 0 });
		assert.doesNotMatch(content, /0 turns|0 tok|\$0\.000/);
	});
});

describe("notify sink", () => {
	beforeEach(() => clearNotifySink());

	it("is off without a sink", () => {
		assert.equal(notifySettled(base), false);
	});

	it("delivers to the installed sink", () => {
		let seen = "";
		setNotifySink((m) => {
			seen = m.content;
		}, "s1");
		assert.equal(notifySettled({ ...base, parentSessionId: "s1" }), true);
		assert.match(seen, /Found the auth module/);
	});

	it("skips another parent session", () => {
		let calls = 0;
		setNotifySink(() => {
			calls += 1;
		}, "s1");
		assert.equal(notifySettled({ ...base, parentSessionId: "s2" }), false);
		assert.equal(calls, 0);
	});

	it("survives a throwing sink", () => {
		setNotifySink(() => {
			throw new Error("no ui");
		});
		assert.equal(notifySettled(base), false);
	});

	it("clears only its own session", () => {
		let calls = 0;
		setNotifySink(() => {
			calls += 1;
		}, "s1");
		clearNotifySink("s2");
		assert.equal(notifySettled({ ...base, parentSessionId: "s1" }), true);
		clearNotifySink("s1");
		assert.equal(notifySettled(base), false);
		assert.equal(calls, 1);
	});
});
