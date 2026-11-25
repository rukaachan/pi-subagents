/**
 * Full e2e: the shipped roster, its defaults, and /delegate.
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
const STARTERS = ["code-reviewer", "explorer", "planner", "researcher", "tester", "worker"];
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

describe("e2e: shipped roster and defaults", () => {
	it(
		"/subagents agent-teams with no names runs every shipped subagent",
		{ timeout: 120_000 },
		async () => {
			await scenario("default-team", async ({ rpc, home }) => {
				const started = await command(
					rpc,
					"/subagents agent-teams E2E_DEFAULT",
					/AgentTeam started ·/,
				);
				assert.match(started, /4 started · 2 queued/, "liveCap 4 queues the last two");
				for (const name of STARTERS) assert.match(started, new RegExp(`\\b${name}\\b`));

				await waitFor(() => hooks(home).length >= STARTERS.length, "one hook per starter");
				assert.deepEqual(
					hooks(home)
						.map((line) => line.subagent)
						.toSorted(),
					[...STARTERS].toSorted(),
				);
				assert.ok(
					hooks(home).every((line) => line.status === "done"),
					"every starter finished",
				);
			});
		},
	);

	it("/delegate with no names runs explorer and worker", { timeout: 120_000 }, async () => {
		await scenario("default-delegate", async ({ rpc, home }) => {
			const started = await command(rpc, "/delegate E2E_PAIR", /started/);
			assert.match(started, /2 started/);
			assert.match(started, /\bexplorer\b/);
			assert.match(started, /\bworker\b/);

			await waitFor(() => hooks(home).length >= 2, "two delegate hooks");
			assert.deepEqual(
				hooks(home)
					.map((line) => line.subagent)
					.toSorted(),
				["explorer", "worker"],
			);

			const reports = await command(rpc, "/delegate reports", /Delegate ·/);
			assert.match(reports, /2 legs · 2 done/);
			assert.match(reports, /explorer/);
			assert.match(reports, /worker/);
			assert.doesNotMatch(reports, /tester|planner/, "delegate stays a pair");
		});
	});

	it("delegate explains its default when typed alone", { timeout: 120_000 }, async () => {
		await scenario("usage", async ({ rpc }) => {
			const delegate = await command(rpc, "/delegate", /Delegate ·/);
			assert.match(delegate, /explorer \+ worker/);
			assert.match(delegate, new RegExp(`Roster \\(${STARTERS.length}\\)`));
		});
	});
});
