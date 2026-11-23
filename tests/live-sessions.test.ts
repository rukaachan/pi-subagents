/**
 * The live-session registry: one handle per running task.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { liveSession, liveSessionCount, registerLiveSession } from "../src/app/live-sessions.ts";

describe("live sessions", () => {
	it("finds a registered session until it is dropped", () => {
		const view = { messages: () => [] };
		const before = liveSessionCount();
		const drop = registerLiveSession("t-1", view);
		try {
			assert.equal(liveSession("t-1"), view);
			assert.equal(liveSessionCount(), before + 1);
		} finally {
			drop();
		}
		assert.equal(liveSession("t-1"), undefined);
		assert.equal(liveSessionCount(), before);
	});

	it("unregisters once and twice without hurting anyone", () => {
		const drop = registerLiveSession("t-2", { messages: () => [] });
		drop();
		drop();
		assert.equal(liveSession("t-2"), undefined);
	});

	it("keeps a newer handle when an older one is dropped late", () => {
		const first = { messages: () => ["old"] };
		const second = { messages: () => ["new"] };
		const dropFirst = registerLiveSession("t-3", first);
		const dropSecond = registerLiveSession("t-3", second);
		try {
			dropFirst();
			assert.equal(liveSession("t-3"), second);
		} finally {
			dropSecond();
		}
		assert.equal(liveSession("t-3"), undefined);
	});
});
