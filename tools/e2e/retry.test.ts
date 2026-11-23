/**
 * Full e2e: a 429 is retried once on the same task id, then succeeds.
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

function noticeRequests(provider: FakeProvider): FakeProvider["requests"] {
	return provider.requests.filter((request) =>
		JSON.stringify(request.body).includes("[subagent settled]"),
	);
}

describe("e2e: bounded retry", () => {
	it("retries a 429 on the same task id and reports once", { timeout: 60_000 }, async () => {
		const provider = await startFakeProvider();
		const home = createE2EHome({ baseUrl: provider.baseUrl, liveCap: 4 });
		const rpc = startRpc(home);
		try {
			await rpc.prompt("E2E_RETRY_PARENT");
			await waitFor(
				() => journal(home).some((event) => event.event === "retry"),
				"retry journal event",
			);
			await waitFor(
				() => stateTasks(home).some((task) => task.status === "done"),
				"done state row",
			);
			await waitFor(() => noticeRequests(provider).length > 0, "settle notice");

			const events = journal(home);
			const retries = events.filter((event) => event.event === "retry");
			assert.equal(retries.length, 1);
			assert.equal(retries[0]?.attempt, 1);
			assert.match(String(retries[0]?.error ?? ""), /429/);

			const id = String(stateTasks(home)[0]?.taskId ?? "");
			const starts = events.filter((event) => event.event === "run_start" && event.id === id);
			const ends = events.filter((event) => event.event === "run_end" && event.id === id);
			assert.equal(starts.length, 2, "two attempts");
			assert.deepEqual(
				ends.map((event) => event.status),
				["error", "done"],
			);

			const row = stateTasks(home).find((task) => task.taskId === id);
			assert.equal(row?.status, "done");
			assert.equal(row?.attempt, 2);
			assert.equal(row?.error, undefined);
			assert.equal(row?.fullDelivered, true);

			const childRequests = provider.requests.filter((request) =>
				/\bE2E_RETRY\b/.test(request.prompt),
			);
			assert.equal(childRequests.length, 2, "one 429 and one success");
			assert.equal(noticeRequests(provider).length, 1, "the failure is not announced");
			assert.match(JSON.stringify(noticeRequests(provider)[0]?.body), /RETRY_DONE/);
		} catch (error) {
			rpc.artifacts(join(repoRoot, "artifacts", "e2e", "retry"));
			throw error;
		} finally {
			await rpc.stop();
			await provider.close();
			home.cleanup();
		}
	});
});
