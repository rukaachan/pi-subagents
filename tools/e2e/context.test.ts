/**
 * Full e2e: project context files reach a child only when the child opts in.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeProvider, systemText, type FakeRequest } from "./fake-provider.ts";
import { createE2EHome, type E2EHome } from "./home.ts";
import { startRpc } from "./rpc.ts";

const TOKEN = "E2E_CTX_TOKEN_7f3a";

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

async function waitFor(check: () => boolean, label: string, timeoutMs = 90_000): Promise<void> {
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

function notesOf(task: Record<string, unknown> | undefined): string {
	const result = task?.result as { notes?: unknown } | undefined;
	return Array.isArray(result?.notes) ? result.notes.join(" | ") : "";
}

/** The requests one child made, found by the token only that child got. */
function requestsFor(requests: FakeRequest[], token: string): FakeRequest[] {
	return requests.filter((request) => request.prompt.includes(token));
}

describe("e2e: child context", () => {
	it("sends AGENTS.md only to the child that asks", { timeout: 120_000 }, async () => {
		const provider = await startFakeProvider();
		const home = createE2EHome({ baseUrl: provider.baseUrl, liveCap: 4 });
		writeFileSync(join(home.agentDir, "AGENTS.md"), `# Project rules\n\n${TOKEN}\n`);
		const rpc = startRpc(home);
		try {
			await rpc.prompt("E2E_CTX");
			await waitFor(
				() =>
					stateTasks(home).filter(
						(task) =>
							(task.subagentName === "e2e-context" || task.subagentName === "e2e-nocontext") &&
							task.status === "done",
					).length >= 2,
				"both context legs done",
			);
			const on = requestsFor(provider.requests, "E2E_CTX_CHILD_ON");
			const off = requestsFor(provider.requests, "E2E_CTX_CHILD_OFF");
			assert.ok(on.length > 0, "the context child reached the model");
			assert.ok(off.length > 0, "the plain child reached the model");
			assert.ok(
				on.every((request) => systemText(request.body).includes(TOKEN)),
				"every request from the context child carries the file token",
			);
			assert.ok(
				off.every((request) => !systemText(request.body).includes(TOKEN)),
				"no request from the plain child carries the file token",
			);

			const tasks = stateTasks(home);
			const onTask = tasks.find((task) => task.subagentName === "e2e-context");
			const offTask = tasks.find((task) => task.subagentName === "e2e-nocontext");
			assert.match(notesOf(onTask), /context: 1 file, \d+ chars \(AGENTS\.md\)/);
			assert.doesNotMatch(notesOf(offTask), /context: /);
		} finally {
			await rpc.stop();
			await provider.close();
			home.cleanup();
		}
	});
});
