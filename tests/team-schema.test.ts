import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PARAMETERS as TEAM } from "../src/infra/team/tools/index.ts";
import { PARAMETERS as MESSAGE } from "../src/infra/team/message/index.ts";
import { MAX_TEAM_TASKS } from "../src/domain/team/index.ts";

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
		const team = shape(TEAM);
		assert.equal(team.type, "object");
		assert.deepEqual(team.required, ["action"]);
		assert.equal("anyOf" in team, false);
		const action = team.properties?.action;
		assert.equal(action?.type, "string");
		assert.deepEqual(action?.enum, [
			"start",
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
		]);
		assert.equal(team.properties?.status?.type, "string");
		assert.deepEqual(team.properties?.status?.enum, ["pending", "in_progress", "completed"]);
		assert.equal(team.properties?.prompt?.type, "string");
		assert.equal(team.properties?.roster?.type, "array");
		assert.equal(team.properties?.limit?.maximum, MAX_TEAM_TASKS);
		const text = JSON.stringify(team);
		assert.equal(text.includes("anyOf"), false);
		assert.equal(text.includes("enable"), false);
		assert.equal(text.includes("disable"), false);
		assert.equal(text.includes("dependencies"), false);
	});

	it("uses one flat, provider-safe TeamMessage shape", () => {
		const message = shape(MESSAGE);
		assert.equal(message.type, "object");
		assert.deepEqual(message.required, ["action"]);
		assert.equal("anyOf" in message, false);
		assert.equal(message.properties?.action?.type, "string");
		assert.deepEqual(message.properties?.action?.enum, ["send", "wait"]);
		assert.equal(JSON.stringify(message).includes("anyOf"), false);
	});
});
