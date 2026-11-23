/**
 * Full e2e: TaskControl steer reaches the child before its next request.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeProvider, type FakeProvider } from "./fake-provider.ts";
import { createE2EHome, type E2EHome } from "./home.ts";
import { startRpc } from "./rpc.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

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

function stateTasks(home: E2EHome): Record<string, unknown>[] {
	if (!existsSync(home.statePath)) return [];
	try {
		const state = JSON.parse(readFileSync(home.statePath, "utf8")) as {
			tasks?: Record<string, unknown>[];
		};
		return state.tasks ?? [];
	} catch {
		return [];
	}
}

function noticeRequests(provider: FakeProvider): FakeProvider["requests"] {
	return provider.requests.filter((request) =>
		JSON.stringify(request.body).includes("[subagent settled]"),
	);
}

describe("e2e: TaskControl stop", () => {
	it("ends one leg and books coordination", { timeout: 60_000 }, async () => {
		const provider = await startFakeProvider();
		const home = createE2EHome({ baseUrl: provider.baseUrl, liveCap: 4 });
		const rpc = startRpc(home);
		try {
			await rpc.prompt("E2E_STOP");
			await waitFor(
				() => journal(home).some((event) => event.event === "stop"),
				"stop journal event",
			);
			const stopped = journal(home).find((event) => event.event === "stop");
			assert.equal(stopped?.family, "coordination");
			const ends = journal(home).filter((event) => event.event === "run_end");
			assert.equal(ends.length, 1);
			assert.equal(ends[0]?.status, "interrupted");
			await waitFor(
				() => !stateTasks(home).some((task) => task.status === "running"),
				"no running row",
			);
			assert.equal(noticeRequests(provider).length, 0, "a stopped leg does not wake the parent");
		} catch (error) {
			rpc.artifacts(join(repoRoot, "artifacts", "e2e", "stop-one"));
			throw error;
		} finally {
			await rpc.stop();
			await provider.close();
			home.cleanup();
		}
	});
});

describe("e2e: TaskControl steer", () => {
	it("delivers the correction to the child", { timeout: 60_000 }, async () => {
		const provider = await startFakeProvider();
		const home = createE2EHome({ baseUrl: provider.baseUrl, liveCap: 4 });
		const rpc = startRpc(home);
		try {
			await rpc.prompt("E2E_STEER");
			await waitFor(
				() => journal(home).some((event) => event.event === "steer"),
				"steer journal event",
			);
			await waitFor(() => noticeRequests(provider).length > 0, "settle notice");

			const steered = journal(home).find((event) => event.event === "steer");
			assert.equal(steered?.text, "E2E_STEER_TEXT");

			const body = JSON.stringify(noticeRequests(provider)[0]?.body);
			assert.match(body, /STEER_APPLIED/);
			assert.doesNotMatch(body, /LONG_DONE/);

			const lastPrompts = provider.requests.map((request) => request.prompt);
			assert.ok(
				lastPrompts.some((prompt) => prompt.includes("E2E_STEER_TEXT")),
				"the child made a request after the steer",
			);
		} catch (error) {
			rpc.artifacts(join(repoRoot, "artifacts", "e2e", "steer"));
			throw error;
		} finally {
			await rpc.stop();
			await provider.close();
			home.cleanup();
		}
	});
});
