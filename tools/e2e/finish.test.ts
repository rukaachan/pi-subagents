/**
 * Full e2e: /subagents finish picks the smallest matched roster.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeProvider } from "./fake-provider.ts";
import { createE2EHome, type E2EHome } from "./home.ts";
import { startRpc, type PiRpc } from "./rpc.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

function hooks(home: E2EHome): Record<string, unknown>[] {
	if (!existsSync(home.hookPath)) return [];
	const text = readFileSync(home.hookPath, "utf8").trim();
	return text ? text.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) : [];
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 30_000): Promise<void> {
	const started = Date.now();
	while (!check()) {
		if (Date.now() - started > timeoutMs) throw new Error(`timeout: ${label}`);
		await sleep(50);
	}
}

async function scenario(
	name: string,
	fn: (ctx: { rpc: PiRpc; home: E2EHome }) => Promise<void>,
): Promise<void> {
	const provider = await startFakeProvider();
	const home = createE2EHome({ baseUrl: provider.baseUrl, subagents: "starters", liveCap: 4 });
	const rpc = startRpc(home);
	try {
		await fn({ rpc, home });
	} catch (error) {
		rpc.artifacts(join(repoRoot, "artifacts", "e2e", name));
		throw error;
	} finally {
		await rpc.stop();
		await provider.close();
		home.cleanup();
	}
}

async function command(rpc: PiRpc, text: string, pattern: RegExp): Promise<string> {
	const from = rpc.events.length;
	await rpc.prompt(text, { waitSettled: false });
	return rpc.waitForNotice(pattern, 30_000, from);
}

describe("e2e: /subagents finish", () => {
	it("picks the matched pair and starts both legs", { timeout: 120_000 }, async () => {
		await scenario("finish-matched", async ({ rpc, home }) => {
			const started = await command(rpc, "/subagents finish review the plan for gaps", /finish ·/);
			assert.match(started, /2 started/);
			assert.match(started, /code-reviewer/);
			assert.match(started, /planner/);
			assert.doesNotMatch(started, /\bworker\b/);
			assert.match(started, /review: "review"/);

			await waitFor(() => hooks(home).length >= 2, "two finish hooks");
			assert.deepEqual(
				hooks(home)
					.map((line) => line.subagent)
					.toSorted(),
				["code-reviewer", "planner"],
			);
			assert.ok(
				hooks(home).every((line) => line.status === "done"),
				"both legs finished",
			);
		});
	});

	it("takes an explicit roster and stops at the cap", { timeout: 120_000 }, async () => {
		await scenario("finish-roster", async ({ rpc, home }) => {
			const started = await command(
				rpc,
				"/subagents finish @tester,worker,explorer,researcher,planner E2E_FINISH",
				/finish ·/,
			);
			assert.match(started, /4 started/);
			assert.match(started, /Over the cap, not started: planner/);
			await waitFor(() => hooks(home).length >= 4, "four finish hooks");
			assert.deepEqual(
				hooks(home)
					.map((line) => line.subagent)
					.toSorted(),
				["explorer", "researcher", "tester", "worker"],
			);
		});
	});
});
