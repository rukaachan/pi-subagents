import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { beginTeamSession, createTask, enableTeam, taskList } from "../src/app/team-store.ts";
import { MAX_TEAM_TASKS } from "../src/domain/team.ts";

beforeEach(() => {
	beginTeamSession("s-list");
});

describe("team list bounds", () => {
	it("returns the whole board at the task cap", () => {
		enableTeam();
		for (let i = 0; i < MAX_TEAM_TASKS; i += 1) {
			const created = createTask({ subject: `task ${i + 1}`, description: "" });
			assert.equal(created.ok, true);
		}
		assert.equal(taskList().length, MAX_TEAM_TASKS);
		assert.equal(taskList({ limit: MAX_TEAM_TASKS }).length, MAX_TEAM_TASKS);
		assert.equal(taskList().at(-1)?.task.id, `task-${MAX_TEAM_TASKS}`);
	});
});
