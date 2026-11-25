/**
 * Full e2e: /subagents agent-teams starts a board plus a worker per leg.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { startFakeProvider } from "./fake-provider.ts";
import { createE2EHome, type E2EHome } from "./home.ts";
import { startRpc, type PiRpc } from "./rpc.ts";

const STARTERS = ["code-reviewer", "explorer", "planner", "researcher", "tester", "worker"];
const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

interface SavedState {
	agentTeam?: {
		enabled?: boolean;
		tasks?: Array<{
			id: string;
			status: string;
			subject: string;
			writeScopes?: string[];
			runId?: string;
			result?: string;
		}>;
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

function hooks(home: E2EHome): Record<string, unknown>[] {
	if (!existsSync(home.hookPath)) return [];
	const text = readFileSync(home.hookPath, "utf8").trim();
	return text ? text.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) : [];
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 60_000): Promise<void> {
	const started = Date.now();
	while (!check()) {
		if (Date.now() - started > timeoutMs) throw new Error(`timeout: ${label}`);
		await sleep(50);
	}
}

async function command(rpc: PiRpc, text: string, pattern: RegExp): Promise<string> {
	const from = rpc.events.length;
	await rpc.prompt(text, { waitSettled: false });
	return rpc.waitForNotice(pattern, 30_000, from);
}

describe("e2e: team start", () => {
	it(
		"creates one task per starter, queues past the cap, and completes each",
		{ timeout: 120_000 },
		async () => {
			const provider = await startFakeProvider({ delayMs: 150 });
			const home = createE2EHome({ baseUrl: provider.baseUrl, subagents: "starters", liveCap: 4 });
			const rpc = startRpc(home);
			try {
				const started = await command(
					rpc,
					"/subagents agent-teams E2E_LAUNCH",
					/AgentTeam started ·/,
				);
				assert.match(started, /4 started · 2 queued/, "liveCap 4 queues two legs");
				for (const name of STARTERS) assert.match(started, new RegExp(`\\b${name}\\b`));

				await waitFor(() => hooks(home).length >= STARTERS.length, "one hook per starter");
				await waitFor(() => {
					const tasks = saved(home).agentTeam?.tasks ?? [];
					return (
						tasks.length === STARTERS.length && tasks.every((task) => task.status === "completed")
					);
				}, "every board task completed");

				const state = saved(home);
				assert.equal(state.agentTeam?.enabled, true);
				assert.equal(state.agentTeam?.tasks?.length, STARTERS.length);
				for (const task of state.agentTeam?.tasks ?? []) {
					assert.match(task.subject, /^\w[\w-]*: E2E_LAUNCH$/);
					assert.match(String(task.runId), /^task-[a-z0-9]+-\d+$/, "the board links its leg run");
					assert.match(String(task.result), /finished task-\d+/, "the board keeps the result");
				}
				assert.ok(
					provider.requests.some((req) => JSON.stringify(req.body).includes("Board task task-")),
					"each child got its board task id",
				);
			} finally {
				await rpc.stop();
				await provider.close();
				home.cleanup();
			}
		},
	);

	it(
		"seeds task scopes from paths and warns when a leg has none",
		{ timeout: 120_000 },
		async () => {
			const provider = await startFakeProvider();
			const home = createE2EHome({ baseUrl: provider.baseUrl, subagents: "fixtures", liveCap: 2 });
			const rpc = startRpc(home);
			try {
				const started = await command(
					rpc,
					"/subagents agent-teams @e2e-scoped,@e2e-leg1 E2E_SCOPED",
					/AgentTeam started ·/,
				);
				assert.match(started, /2 started/);
				assert.match(started, /Warning: no write scopes on e2e-leg1/);
				await waitFor(() => hooks(home).length >= 2, "two hooks");
				await waitFor(() => {
					const tasks = saved(home).agentTeam?.tasks ?? [];
					return tasks.length === 2 && tasks.every((task) => task.status === "completed");
				}, "both tasks completed");
				const tasks = saved(home).agentTeam?.tasks ?? [];
				const scoped = tasks.find((task) => task.subject.startsWith("e2e-scoped:"));
				const unscoped = tasks.find((task) => task.subject.startsWith("e2e-leg1:"));
				assert.deepEqual(scoped?.writeScopes, ["src"]);
				assert.deepEqual(unscoped?.writeScopes, []);
			} finally {
				await rpc.stop();
				await provider.close();
				home.cleanup();
			}
		},
	);

	it("starts a named pair with no queue when the cap fits", { timeout: 120_000 }, async () => {
		const provider = await startFakeProvider();
		const home = createE2EHome({ baseUrl: provider.baseUrl, subagents: "starters", liveCap: 2 });
		const rpc = startRpc(home);
		try {
			const started = await command(
				rpc,
				"/subagents agent-teams @worker,@tester E2E_LAUNCH",
				/AgentTeam started ·/,
			);
			assert.match(started, /2 started/);
			assert.doesNotMatch(started, /queued/);
			await waitFor(() => hooks(home).length >= 2, "two hooks");
			await waitFor(() => {
				const tasks = saved(home).agentTeam?.tasks ?? [];
				return tasks.length === 2 && tasks.every((task) => task.status === "completed");
			}, "both tasks completed");
			assert.equal(hooks(home).length, 2);
		} finally {
			await rpc.stop();
			await provider.close();
			home.cleanup();
		}
	});
});
