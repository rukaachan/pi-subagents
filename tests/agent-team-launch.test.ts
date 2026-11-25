import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginAgentTeamSession, agentTeamEnabled } from "../src/app/agent-team/board/index.ts";
import { startAgentTeamLaunch } from "../src/app/agent-team/run/index.ts";
import { MAX_AGENT_TEAM_MEMBERS } from "../src/domain/agent-team/index.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const project = mkdtempSync(join(tmpdir(), "pi-team-launch-"));
mkdirSync(join(project, ".pi", "subagents"), { recursive: true });
writeFileSync(
	join(project, ".pi", "subagents", "worker.md"),
	"---\nname: worker\ndescription: test worker\ntools: read\n---\n\nDo the task.\n",
);

after(() => {
	rmSync(project, { recursive: true, force: true });
});

function ctx(): ExtensionContext {
	return { cwd: project, ui: { setStatus: () => {} } } as unknown as ExtensionContext;
}

beforeEach(() => {
	beginAgentTeamSession("s-launch");
});

describe("team start", () => {
	it("needs a prompt", async () => {
		const result = await startAgentTeamLaunch({} as never, { prompt: "   " }, ctx(), {} as never);
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, /needs a prompt/);
		assert.equal(agentTeamEnabled(), false);
	});

	it("caps the prompt before it touches the board", async () => {
		const result = await startAgentTeamLaunch(
			{} as never,
			{ prompt: "x".repeat(2_001) },
			ctx(),
			{} as never,
		);
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, /2000/);
		assert.equal(agentTeamEnabled(), false);
	});

	it("caps a start at the member ceiling", async () => {
		const roster = Array.from({ length: MAX_AGENT_TEAM_MEMBERS + 1 }, (_, i) => `m${i}`);
		const result = await startAgentTeamLaunch(
			{} as never,
			{ prompt: "map auth", roster },
			ctx(),
			{} as never,
		);
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, /32 legs/);
		assert.equal(agentTeamEnabled(), false);
	});

	it("leaves the board off when the roster is unknown", async () => {
		assert.equal(agentTeamEnabled(), false);
		const result = await startAgentTeamLaunch(
			{} as never,
			{ prompt: "map auth", roster: ["ghost"] },
			ctx(),
			{} as never,
		);
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, /Unknown subagent/);
		assert.equal(agentTeamEnabled(), false);
	});
});
