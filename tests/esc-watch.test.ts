/**
 * The Esc watcher.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { matchesKey } from "@earendil-works/pi-tui";
import { watchEscapeKey } from "../src/app/esc-watch.ts";

/** The host's own UI port, cut down to what the watcher touches. */
function fakeUI() {
	const handlers: Array<(data: string) => { consume?: boolean; data?: string } | undefined> = [];
	const notes: string[] = [];
	return {
		notes,
		handlers,
		port: {
			onTerminalInput(handler: (typeof handlers)[number]) {
				handlers.push(handler);
				return () => {
					const at = handlers.indexOf(handler);
					if (at >= 0) handlers.splice(at, 1);
				};
			},
			notify(message: string) {
				notes.push(message);
			},
		},
	};
}

function actions(live: boolean) {
	const calls: number[] = [];
	return {
		calls,
		value: {
			hasLive: () => live,
			stopAll: () => {
				calls.push(1);
				return "Stopped 2 subagents (Esc): worker, explorer.";
			},
		},
	};
}

describe("the Esc watcher", () => {
	it("stops the runs and says so, and lets the key through", () => {
		const ui = fakeUI();
		const a = actions(true);
		watchEscapeKey(ui.port, a.value);
		const result = ui.handlers[0]?.("\x1b");
		assert.equal(a.calls.length, 1);
		assert.deepEqual(ui.notes, ["Stopped 2 subagents (Esc): worker, explorer."]);
		assert.equal(result, undefined, "Esc is never consumed: pi's interrupt must run");
	});

	it("ignores every other key", () => {
		const ui = fakeUI();
		const a = actions(true);
		watchEscapeKey(ui.port, a.value);
		for (const key of ["a", "\x03", "\x1b[A", "\x1bq"]) ui.handlers[0]?.(key);
		assert.deepEqual(a.calls, [], "an arrow key is not Esc");
		assert.deepEqual(ui.notes, []);
	});

	it("does nothing when no subagent is live", () => {
		const ui = fakeUI();
		const a = actions(false);
		watchEscapeKey(ui.port, a.value);
		ui.handlers[0]?.("\x1b");
		assert.deepEqual(a.calls, []);
		assert.deepEqual(ui.notes, [], "no notice when there is nothing to stop");
	});

	it("stays quiet when the stop throws, so typing still works", () => {
		const ui = fakeUI();
		watchEscapeKey(ui.port, {
			hasLive: () => true,
			stopAll: () => {
				throw new Error("boom");
			},
		});
		assert.doesNotThrow(() => ui.handlers[0]?.("\x1b"));
		assert.deepEqual(ui.notes, []);
	});

	it("comes off the terminal input when removed", () => {
		const ui = fakeUI();
		const unwatch = watchEscapeKey(ui.port, actions(true).value);
		assert.equal(ui.handlers.length, 1);
		unwatch();
		assert.equal(ui.handlers.length, 0);
	});
});

describe("Esc really is the lone escape byte", () => {
	it("matches \\x1b and nothing that starts with it", () => {
		assert.equal(matchesKey("\x1b", "escape"), true);
		assert.equal(matchesKey("\x1b[A", "escape"), false);
		assert.equal(matchesKey("\x1bq", "escape"), false);
		assert.equal(matchesKey("\x03", "escape"), false);
	});
});

describe("the extension wires the watcher", () => {
	const source = readFileSync("extensions/index.ts", "utf8");

	it("does not register a shortcut on the reserved key", () => {
		assert.doesNotMatch(source, /registerShortcut\("escape"/);
	});

	it("installs the watcher on session_start and drops it on shutdown", () => {
		assert.match(source, /on\("session_start"/);
		assert.match(source, /watchEscapeKey\(ctx\.ui/);
		assert.match(source, /hasLive: \(\) => liveCount\(\) > 0/);
		const shutdown = source.slice(source.indexOf('on("session_shutdown"'));
		assert.ok(shutdown.includes("unwatch?.()"), "the listener must come off at shutdown");
	});
});
