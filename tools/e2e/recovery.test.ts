/**
 * Full e2e: a chain cut short keeps its later steps pending.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeProvider, systemText, type FakeRequest } from "./fake-provider.ts";
import { createE2EHome, type E2EHome } from "./home.ts";
import { startRpc } from "./rpc.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

interface StateTask {
	taskId: string;
	status: string;
	kind?: string;
	steps?: { status: string }[];
}

function stateTasks(home: E2EHome): StateTask[] {
	if (!existsSync(home.statePath)) return [];
	try {
		const state = JSON.parse(readFileSync(home.statePath, "utf8")) as { tasks?: StateTask[] };
		return state.tasks ?? [];
	} catch {
		return [];
	}
}

function journal(home: E2EHome): Record<string, unknown>[] {
	if (!existsSync(home.journalPath)) return [];
	return readFileSync(home.journalPath, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 20_000): Promise<void> {
	const started = Date.now();
	while (!check()) {
		if (Date.now() - started > timeoutMs) throw new Error(`timeout: ${label}`);
		await sleep(50);
	}
}

describe("e2e: recovery", () => {
	it(
		"leaves the later chain step pending when the chain is stopped",
		{ timeout: 60_000 },
		async () => {
			const provider = await startFakeProvider();
			const home = await createE2EHome({ baseUrl: provider.baseUrl, liveCap: 12 });
			const rpc = startRpc(home);
			try {
				await rpc.prompt("E2E_CHAIN_STOP");
				await waitFor(
					() => stateTasks(home).some((task) => task.kind === "chain" && task.status === "error"),
					"the stopped chain row",
				);
				const chain = stateTasks(home).find((task) => task.kind === "chain");
				if (!chain) assert.fail("missing the chain row");
				assert.deepEqual(
					(chain.steps ?? []).map((step) => step.status),
					["error", "pending"],
					"the cut step fails and the next one never starts",
				);
				assert.ok(
					journal(home).some((event) => event.event === "stop" && event.id === chain.taskId),
					"the stop is journaled",
				);
				const stepTwo = provider.requests.filter((request: FakeRequest) =>
					systemText(request.body).includes("e2e-b"),
				);
				assert.equal(stepTwo.length, 0, "step two never reached the provider");
			} catch (error) {
				rpc.artifacts(join(repoRoot, "artifacts", "e2e", "chain-stop"));
				throw error;
			} finally {
				await rpc.stop();
				await provider.close();
				home.cleanup();
			}
		},
	);
});
