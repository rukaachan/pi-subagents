import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	beginAgentTeamSession,
	createTask,
	enableAgentTeam,
	taskList,
} from "../src/app/agent-team/board/index.ts";
import { MAX_AGENT_TEAM_TASKS } from "../src/domain/agent-team/index.ts";

beforeEach(() => {
	beginAgentTeamSession("s-list");
});

describe("team list bounds", () => {
	it("returns the whole board at the task cap", () => {
		enableAgentTeam();
		for (let i = 0; i < MAX_AGENT_TEAM_TASKS; i += 1) {
			const created = createTask({ subject: `task ${i + 1}`, description: "" });
			assert.equal(created.ok, true);
		}
		assert.equal(taskList().length, MAX_AGENT_TEAM_TASKS);
		assert.equal(taskList({ limit: MAX_AGENT_TEAM_TASKS }).length, MAX_AGENT_TEAM_TASKS);
		assert.equal(taskList().at(-1)?.task.id, `task-${MAX_AGENT_TEAM_TASKS}`);
	});
});
