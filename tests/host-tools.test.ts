import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { activateTools } from "../src/infra/host/session/index.ts";

describe("child tool activation", () => {
	it("adds the extra tool to an explicit list", () => {
		assert.deepEqual(activateTools(["read", "edit"], ["Team"]), ["read", "edit", "Team"]);
		assert.deepEqual(activateTools(["read", "Team"], ["Team"]), ["read", "Team"]);
	});

	it("uses a modifier when the subagent has no list", () => {
		assert.deepEqual(activateTools(undefined, ["Team"]), ["+Team"]);
		assert.equal(activateTools(undefined, []), undefined);
	});
});
