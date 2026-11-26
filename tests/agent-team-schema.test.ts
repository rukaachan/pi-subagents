import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PARAMETERS as TEAM } from "../src/infra/agent-team/tools/index.ts";
import { PARAMETERS as MESSAGE } from "../src/infra/agent-team/message/index.ts";
import { MAX_AGENT_TEAM_TASKS } from "../src/domain/agent-team/index.ts";

interface Shape {
	type?: string;
	required?: string[];
	properties?: Record<string, { enum?: string[]; type?: string; maximum?: number }>;
}

function shape(schema: unknown): Shape {
	return JSON.parse(JSON.stringify(schema)) as Shape;
}

describe("team tool schemas", () => {
	it("uses one flat, provider-safe Team shape", () => {
		const agentTeam = shape(TEAM);
		assert.equal(agentTeam.type, "object");
		assert.deepEqual(agentTeam.required, ["action"]);
		assert.equal("anyOf" in agentTeam, false);
		const action = agentTeam.properties?.action;
		assert.equal(action?.type, "string");
		assert.deepEqual(action?.enum, [
			"start",
			"round",
			"status",
			"list",
			"get",
			"resolve",
			"create",
			"claim",
			"release",
			"edit",
			"complete",
			"reopen",
			"reassign",
			"delete",
			"verify",
			"advise",
			"brief",
			"worktree",
			"promote",
		]);
		assert.equal(agentTeam.properties?.status?.type, "string");
		assert.deepEqual(agentTeam.properties?.status?.enum, [
			"pending",
			"in_progress",
			"in_review",
			"completed",
		]);
		assert.equal(agentTeam.properties?.fact?.type, "string");
		assert.equal(agentTeam.properties?.excluded?.type, "string");
		assert.equal(agentTeam.properties?.prompt?.type, "string");
		assert.equal(agentTeam.properties?.roster?.type, "array");
		assert.equal(agentTeam.properties?.limit?.maximum, MAX_AGENT_TEAM_TASKS);
		const text = JSON.stringify(agentTeam);
		assert.equal(text.includes("anyOf"), false);
		assert.equal(text.includes("enable"), false);
		assert.equal(text.includes("disable"), false);
		assert.equal(text.includes("dependencies"), false);
	});

	it("uses one flat, provider-safe AgentTeamMessage shape", () => {
		const message = shape(MESSAGE);
		assert.equal(message.type, "object");
		assert.deepEqual(message.required, ["action"]);
		assert.equal("anyOf" in message, false);
		assert.equal(message.properties?.action?.type, "string");
		assert.deepEqual(message.properties?.action?.enum, ["send", "wait"]);
		assert.equal(JSON.stringify(message).includes("anyOf"), false);
	});
});
