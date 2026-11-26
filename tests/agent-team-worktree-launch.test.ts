import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TaskStore } from "../src/domain/task/index.ts";
import {
	agentTeamBoard,
	agentTeamEnabled,
	beginAgentTeamSession,
	disableAgentTeam,
} from "../src/app/agent-team/board/index.ts";
import { startAgentTeamLaunch } from "../src/app/agent-team/run/index.ts";

function ctx(cwd: string): ExtensionContext {
	return { cwd, ui: { setStatus: () => {} } } as unknown as ExtensionContext;
}

let dir = "";

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-team-wt-launch-"));
	mkdirSync(join(dir, ".pi", "subagents"), { recursive: true });
	copyFileSync(
		join(process.cwd(), "subagents", "worker.md"),
		join(dir, ".pi", "subagents", "worker.md"),
	);
	beginAgentTeamSession("s-wt-launch");
	disableAgentTeam();
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("worktree launch", () => {
	it("refuses a non-git workspace and rolls the tasks back", async () => {
		const result = await startAgentTeamLaunch(
			new TaskStore(),
			{ prompt: "do it", roster: ["worker"], isolation: "worktree" },
			ctx(dir),
			{} as never,
		);
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, /not a git repository/);
		assert.equal(agentTeamBoard().tasks.filter((task) => task.status !== "deleted").length, 0);
		assert.equal(agentTeamEnabled(), false);
	});
});
