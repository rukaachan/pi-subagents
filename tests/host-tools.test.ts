import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { activateTools } from "../src/infra/host/session/index.ts";

describe("child tool activation", () => {
	it("adds the extra tool to an explicit list", () => {
		assert.deepEqual(activateTools(["read", "edit"], ["AgentTeam"]), ["read", "edit", "AgentTeam"]);
		assert.deepEqual(activateTools(["read", "AgentTeam"], ["AgentTeam"]), ["read", "AgentTeam"]);
	});

	it("uses a modifier when the subagent has no list", () => {
		assert.deepEqual(activateTools(undefined, ["AgentTeam"]), ["+AgentTeam"]);
		assert.equal(activateTools(undefined, []), undefined);
	});
});
