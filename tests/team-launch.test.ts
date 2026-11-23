import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { beginTeamSession, teamEnabled } from "../src/app/team-store.ts";
import { startTeamLaunch } from "../src/app/team-launch.ts";
import { MAX_TEAM_MEMBERS } from "../src/domain/team.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

function ctx(): ExtensionContext {
	return { cwd: process.cwd(), ui: { setStatus: () => {} } } as unknown as ExtensionContext;
}

beforeEach(() => {
	beginTeamSession("s-launch");
});

describe("team start", () => {
	it("needs a prompt", async () => {
		const result = await startTeamLaunch({} as never, { prompt: "   " }, ctx());
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, /needs a prompt/);
		assert.equal(teamEnabled(), false);
	});

	it("caps the prompt before it touches the board", async () => {
		const result = await startTeamLaunch({} as never, { prompt: "x".repeat(2_001) }, ctx());
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, /2000/);
		assert.equal(teamEnabled(), false);
	});

	it("caps a start at the member ceiling", async () => {
		const roster = Array.from({ length: MAX_TEAM_MEMBERS + 1 }, (_, i) => `m${i}`);
		const result = await startTeamLaunch({} as never, { prompt: "map auth", roster }, ctx());
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, /32 legs/);
		assert.equal(teamEnabled(), false);
	});

	it("leaves the board off when the roster is unknown", async () => {
		assert.equal(teamEnabled(), false);
		const result = await startTeamLaunch(
			{} as never,
			{ prompt: "map auth", roster: ["ghost"] },
			ctx(),
		);
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, /Unknown subagent/);
		assert.equal(teamEnabled(), false);
	});
});
