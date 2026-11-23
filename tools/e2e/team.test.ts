/**
 * Full e2e: a lead creates a task, a leg claims and completes it.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { startFakeProvider } from "./fake-provider.ts";
import { createE2EHome, type E2EHome } from "./home.ts";
import { startRpc, type PiRpc } from "./rpc.ts";

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

async function waitFor(check: () => boolean, label: string, timeoutMs = 30_000): Promise<void> {
	const started = Date.now();
	while (!check()) {
		if (Date.now() - started > timeoutMs) throw new Error(`timeout: ${label}`);
		await sleep(50);
	}
}

function hooks(home: E2EHome): Record<string, unknown>[] {
	if (!existsSync(home.hookPath)) return [];
	const text = readFileSync(home.hookPath, "utf8").trim();
	return text ? text.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) : [];
}

interface SavedState {
	team?: {
		enabled?: boolean;
		tasks?: Array<{ id: string; status: string; owner?: string; revision: number }>;
	};
}

function saved(home: E2EHome): SavedState {
	if (!existsSync(home.statePath)) return {};
	try {
		return JSON.parse(readFileSync(home.statePath, "utf8")) as SavedState;
	} catch {
		return {};
	}
}

async function command(rpc: PiRpc, text: string, pattern: RegExp): Promise<string> {
	const from = rpc.events.length;
	await rpc.prompt(text, { waitSettled: false });
	return rpc.waitForNotice(pattern, 30_000, from);
}

describe("e2e: teams", () => {
	it(
		"passes a finding between live workers and the lead reads it",
		{ timeout: 120_000 },
		async () => {
			const provider = await startFakeProvider();
			const home = createE2EHome({ baseUrl: provider.baseUrl, subagents: "starters", liveCap: 4 });
			const rpc = startRpc(home);
			try {
				await command(rpc, "/subagents team on", /Team mode on/);
				await rpc.prompt("E2E_TEAM_MAIL", { waitSettled: false });
				await waitFor(
					() => {
						const tasks = saved(home).team?.tasks ?? [];
						return tasks.length === 2 && tasks.every((task) => task.status === "completed");
					},
					"both mail tasks completed",
					60_000,
				);
				const tasks = saved(home).team?.tasks ?? [];
				assert.deepEqual(tasks.map((task) => task.owner).toSorted(), ["worker", "worker-2"]);
				assert.ok(
					provider.requests.some((req) =>
						JSON.stringify(req.body).includes(
							"[team message] from worker: found the bug in parser",
						),
					),
					"the steer reached the receiver",
				);
				assert.ok(
					provider.requests.some((req) =>
						JSON.stringify(req.body).includes("MAIL_RECEIVED: found the bug in parser"),
					),
					"the lead read the receiver report",
				);
			} finally {
				await rpc.stop();
				await provider.close();
				home.cleanup();
			}
		},
	);

	it("wakes the lead with a worker message", { timeout: 120_000 }, async () => {
		const provider = await startFakeProvider();
		const home = createE2EHome({ baseUrl: provider.baseUrl, subagents: "starters", liveCap: 4 });
		const rpc = startRpc(home);
		try {
			await command(rpc, "/subagents team on", /Team mode on/);
			await rpc.prompt("E2E_TEAM_PING", { waitSettled: false });
			await waitFor(
				() => saved(home).team?.tasks?.[0]?.status === "completed",
				"ping task completed",
			);
			await waitFor(
				() =>
					provider.requests.some((req) =>
						JSON.stringify(req.body).includes("[team message] from worker: ping from the worker"),
					),
				"lead inbox woke",
			);
		} finally {
			await rpc.stop();
			await provider.close();
			home.cleanup();
		}
	});

	it("releases a failed leg's task and wakes the lead", { timeout: 120_000 }, async () => {
		const provider = await startFakeProvider();
		const home = createE2EHome({ baseUrl: provider.baseUrl, subagents: "starters", liveCap: 4 });
		const rpc = startRpc(home);
		try {
			await command(rpc, "/subagents team on", /Team mode on/);
			await rpc.prompt("E2E_TEAM_FAIL", { waitSettled: false });
			await waitFor(
				() => saved(home).team?.tasks?.[0]?.revision === 3,
				"failed task released on disk",
			);
			const task = saved(home).team?.tasks?.[0];
			assert.equal(task?.status, "pending");
			assert.equal(task?.owner, undefined);
			assert.ok(
				provider.requests.some((req) => JSON.stringify(req.body).includes("Released task-1")),
				"the settle notice named the released task",
			);
			const board = await command(rpc, "/subagents team", /1 open/);
			assert.match(board, /last worker: Provider finish_reason: content_filter/);
		} finally {
			await rpc.stop();
			await provider.close();
			home.cleanup();
		}
	});

	it("creates, claims, completes, and reloads the board", { timeout: 120_000 }, async () => {
		const provider = await startFakeProvider();
		const home = createE2EHome({ baseUrl: provider.baseUrl, subagents: "starters", liveCap: 4 });
		const rpc = startRpc(home);
		try {
			await command(rpc, "/subagents team on", /Team mode on/);
			await rpc.prompt("E2E_TEAM", { waitSettled: false });
			await waitFor(() => hooks(home).length >= 1, "team leg finished");
			await waitFor(
				() => saved(home).team?.tasks?.[0]?.status === "completed",
				"task completed on disk",
			);
			assert.ok(
				provider.requests.some((req) => JSON.stringify(req.body).includes("Agent Team mode is on")),
				"the lead policy reached the model",
			);
			const state = saved(home);
			assert.equal(state.team?.enabled, true);
			assert.equal(state.team?.tasks?.[0]?.id, "task-1");
			assert.equal(state.team?.tasks?.[0]?.owner, "worker");
			const board = await command(rpc, "/subagents team", /1 done/);
			assert.match(board, /task-1/);
			assert.match(board, /E2E task/);
			await command(rpc, "/subagents team off", /Team mode off/);
			const kept = await command(rpc, "/subagents team", /1 done/);
			assert.match(kept, /task-1/);
		} finally {
			await rpc.stop();
			await provider.close();
			home.cleanup();
		}
	});
});
