/**
 * Full e2e: a finished background leg wakes the parent with its report.
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

describe("e2e: settle wake", () => {
	it("wakes the parent with the report and no poll", { timeout: 60_000 }, async () => {
		const provider = await startFakeProvider();
		const home = createE2EHome({ baseUrl: provider.baseUrl, liveCap: 4 });
		const rpc = startRpc(home);
		try {
			const from = rpc.events.length;
			await rpc.prompt("E2E_WAKE");
			await waitFor(() => noticeRequests(provider).length > 0, "settle notice request");
			const noticeAt = noticeRequests(provider)[0]?.at ?? Date.now();
			await rpc.waitForEvent(
				(event) => event.type === "agent_settled" && event.at >= noticeAt,
				"wake turn settled",
				30_000,
				from,
			);

			const notices = noticeRequests(provider);
			assert.equal(notices.length, 1, "exactly one notice request");
			const body = JSON.stringify(notices[0]?.body);
			assert.match(body, /\[subagent settled\] e2e-a/);
			assert.match(body, /CHILD_REPORT/);
			assert.match(body, /This report is final\. Do not poll TaskOutput/);

			assert.ok(
				!rpc.events
					.slice(from)
					.some(
						(event) => event.type === "tool_execution_start" && event.raw.toolName === "TaskOutput",
					),
				"the parent never polls",
			);

			await waitFor(
				() =>
					stateTasks(home).some(
						(task) =>
							task.subagentName === "e2e-a" &&
							task.status === "done" &&
							task.fullDelivered === true,
					),
				"delivered state row",
			);

			const runs = journal(home).filter((event) => event.event === "run_start");
			assert.equal(runs.length, 1, "one child run");
			assert.equal(runs[0]?.kind, "background");
		} catch (error) {
			rpc.artifacts(join(repoRoot, "artifacts", "e2e", "wake"));
			throw error;
		} finally {
			await rpc.stop();
			await provider.close();
			home.cleanup();
		}
	});
});
