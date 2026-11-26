import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TaskStore } from "../src/domain/task/index.ts";
import { startLaunch, stopLaunchSchedulers } from "../src/app/launch/index.ts";
import { discoverSubagents } from "../src/infra/files/index.ts";
import { withTemps } from "../src/domain/run/index.ts";

function ctx(): ExtensionContext {
	return {
		cwd: process.cwd(),
		ui: { setStatus: () => {} },
		sessionManager: { getSessionId: () => "s-cwd" },
	} as unknown as ExtensionContext;
}

afterEach(() => {
	stopLaunchSchedulers();
});

describe("launch cwd isolation", () => {
	it("hands each leg its own cwd", () => {
		const { subagents } = withTemps(discoverSubagents(process.cwd()));
		const name = subagents[0]?.name;
		if (!name) return;
		const store = new TaskStore();
		const started = startLaunch(
			store,
			"agent-team",
			[name],
			"probe",
			ctx(),
			{
				child: {
					create: async () => {
						throw new Error("stop after cwd");
					},
				},
			},
			{ cwdFor: () => "/tmp/isolated-leg" },
		);
		assert.ok(started.ok);
		const taskId = started.run.legs[0]?.taskId;
		assert.ok(taskId);
		assert.equal(store.get(taskId)?.cwd, "/tmp/isolated-leg");
	});
});
