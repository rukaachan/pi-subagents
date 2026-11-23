/**
 * Full e2e: the hybrid ladder, one Task, and Team start without a command.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { startFakeProvider } from "./fake-provider.ts";
import { createE2EHome, type E2EHome } from "./home.ts";
import { startRpc } from "./rpc.ts";

interface Saved {
	team?: { enabled?: boolean; tasks?: Array<{ status: string }> };
	tasks?: Array<{ status: string }>;
}

function saved(home: E2EHome): Saved {
	if (!existsSync(home.statePath)) return {};
	try {
		return JSON.parse(readFileSync(home.statePath, "utf8")) as Saved;
	} catch {
		return {};
	}
}

function hooks(home: E2EHome): number {
	if (!existsSync(home.hookPath)) return 0;
	return readFileSync(home.hookPath, "utf8").trim().split("\n").filter(Boolean).length;
}

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

async function waitFor(check: () => boolean, label: string, timeoutMs = 60_000): Promise<void> {
	const started = Date.now();
	while (!check()) {
		if (Date.now() - started > timeoutMs) throw new Error(`timeout: ${label}`);
		await sleep(50);
	}
}

async function scenario(
	name: string,
	fn: (ctx: {
		home: E2EHome;
		provider: Awaited<ReturnType<typeof startFakeProvider>>;
		rpc: ReturnType<typeof startRpc>;
	}) => Promise<void>,
): Promise<void> {
	const provider = await startFakeProvider();
	const home = createE2EHome({ baseUrl: provider.baseUrl, subagents: "starters" });
	const rpc = startRpc(home);
	try {
		await fn({ home, provider, rpc });
	} catch (error) {
		rpc.artifacts(`artifacts/e2e/${name}`);
		throw error;
	} finally {
		await rpc.stop();
		await provider.close();
		home.cleanup();
	}
}

describe("e2e: hybrid policy", () => {
	it("registers only /subagents and /delegate", { timeout: 60_000 }, async () => {
		await scenario("hybrid-surface", async ({ rpc }) => {
			const response = await rpc.request({ type: "get_commands" });
			const commands = ((response.data?.commands ?? []) as Array<{ name: string; source: string }>)
				.filter((command) => command.source === "extension")
				.map((command) => command.name);
			assert.deepEqual(commands.toSorted(), ["delegate", "subagents"]);
		});
	});

	it("injects the ladder while team mode is off", { timeout: 60_000 }, async () => {
		await scenario("hybrid-policy", async ({ provider, rpc }) => {
			await rpc.prompt("E2E_HYBRID_POLICY");
			const body = JSON.stringify(provider.requests.map((request) => request.body));
			assert.ok(body.includes("Hybrid delegation: pick the smallest level"));
			assert.ok(body.includes("Team { action:"));
			assert.ok(body.includes("one worker per leg"));
			assert.ok(!body.includes("Agent Team mode is on"));
		});
	});

	it("keeps a one-job run out of the team", { timeout: 60_000 }, async () => {
		await scenario("hybrid-one-job", async ({ home, rpc }) => {
			await rpc.prompt("E2E_ONE_JOB", { waitSettled: false });
			await waitFor(() => hooks(home) >= 1, "one child hook");
			await waitFor(() => saved(home).tasks?.length === 1, "one task row saved");
			const state = saved(home);
			assert.equal(state.team?.enabled, false);
			assert.deepEqual(state.team?.tasks, []);
			assert.equal(state.tasks?.length, 1);
		});
	});

	it(
		"lets the lead start a team with no command and complete its task",
		{ timeout: 90_000 },
		async () => {
			await scenario("hybrid-team", async ({ home, rpc }) => {
				await rpc.prompt("E2E_HYBRID_START", { waitSettled: false });
				await waitFor(() => hooks(home) >= 1, "one team child hook");
				await waitFor(() => {
					const tasks = saved(home).team?.tasks ?? [];
					return tasks.length === 1 && tasks[0]?.status === "completed";
				}, "team task completed");
				const state = saved(home);
				assert.equal(state.team?.enabled, true);
				assert.equal(state.team?.tasks?.length, 1);
			});
		},
	);
});
