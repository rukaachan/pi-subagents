/**
 * The board shows only this project and this session.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inTaskScope, scopeTasks } from "../src/app/session/index.ts";
import { rec } from "./board-fixtures.ts";

const scope = { cwd: "/repo", sessionId: "s1" };

describe("task scope", () => {
	it("keeps a run from the same project and session", () => {
		const task = rec({ cwd: "/repo", sessionId: "s1" });
		assert.equal(inTaskScope(task, scope), true);
	});

	it("drops another project even from the same session", () => {
		const task = rec({ cwd: "/other", sessionId: "s1" });
		assert.equal(inTaskScope(task, scope), false);
	});

	it("drops another session in the same project", () => {
		const task = rec({ cwd: "/repo", sessionId: "s2" });
		assert.equal(inTaskScope(task, scope), false);
	});

	it("drops legacy rows with no session id", () => {
		const task = rec({ cwd: "/repo" });
		assert.equal(inTaskScope(task, scope), false);
	});

	it("filters a mixed list in one pass", () => {
		const tasks = [
			rec({ taskId: "mine", cwd: "/repo", sessionId: "s1" }),
			rec({ taskId: "old", cwd: "/repo", sessionId: "s0" }),
			rec({ taskId: "far", cwd: "/other", sessionId: "s1" }),
		];
		assert.deepEqual(
			scopeTasks(tasks, scope).map((task) => task.taskId),
			["mine"],
		);
	});
});
