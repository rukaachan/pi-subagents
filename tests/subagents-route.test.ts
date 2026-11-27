/**
 * /subagents routing: words, team aliases, and the bare-prompt fallback.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { routeSubagents } from "../src/ui/commands/index.ts";

describe("subagents route", () => {
	it("opens the board on an empty command", () => {
		assert.deepEqual(routeSubagents(""), { kind: "board" });
		assert.deepEqual(routeSubagents("   "), { kind: "board" });
	});

	it("opens help for help and the hidden ? alias", () => {
		assert.deepEqual(routeSubagents("help"), { kind: "help" });
		assert.deepEqual(routeSubagents("?"), { kind: "help" });
	});

	it("runs run and finish prompts", () => {
		assert.deepEqual(routeSubagents("run fix the tests"), {
			kind: "quick",
			prompt: "fix the tests",
		});
		assert.deepEqual(routeSubagents("finish"), { kind: "quick", prompt: "" });
	});

	it("keeps every team alias", () => {
		assert.deepEqual(routeSubagents("team"), { kind: "team-board" });
		assert.deepEqual(routeSubagents("agent-team"), { kind: "team-board" });
		assert.deepEqual(routeSubagents("agent-teams"), { kind: "team-board" });
		assert.deepEqual(routeSubagents("team on"), { kind: "team-on" });
		assert.deepEqual(routeSubagents("agent-teams off"), { kind: "team-off" });
		assert.deepEqual(routeSubagents("team @a fix it"), {
			kind: "team",
			prompt: "@a fix it",
		});
	});

	it("keeps the management words", () => {
		assert.deepEqual(routeSubagents("new"), { kind: "new" });
		assert.deepEqual(routeSubagents("list"), { kind: "list" });
		assert.deepEqual(routeSubagents("tasks"), { kind: "tasks" });
		assert.deepEqual(routeSubagents("trash"), { kind: "trash" });
	});

	it("leaves any other text for the known-name lookup", () => {
		assert.deepEqual(routeSubagents("worker"), { kind: "name", name: "worker" });
		assert.deepEqual(routeSubagents("worker fix it"), {
			kind: "name",
			name: "worker fix it",
		});
		assert.deepEqual(routeSubagents("Fix The Tests"), {
			kind: "name",
			name: "Fix The Tests",
		});
	});
});
