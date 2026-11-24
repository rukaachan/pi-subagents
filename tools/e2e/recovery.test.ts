/**
 * Full e2e: resume after stop, a partial fanout, and a chain cut short.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeProvider, systemText, type FakeRequest } from "./fake-provider.ts";
import { createE2EHome, type E2EHome } from "./home.ts";
import { startRpc, type PiRpc } from "./rpc.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

interface StateTask {
	taskId: string;
	subagentName: string;
	description: string;
	status: string;
	kind?: string;
	runId?: string;
	error?: string;
	steps?: { status: string }[];
	result?: { text?: string };
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

function scenario(name: string) {
	const server = startFakeProvider();
	const home: Promise<E2EHome> = server.then((s) =>
		createE2EHome({ baseUrl: s.baseUrl, liveCap: 12 }),
	);
	let rpc: PiRpc | undefined;
	return {
		run: async (
			fn: (ctx: { rpc: PiRpc; home: E2EHome; provider: Awaited<typeof server> }) => Promise<void>,
		) => {
			const [provider, isolated] = await Promise.all([server, home]);
			rpc = startRpc(isolated);
			try {
				await fn({ rpc, home: isolated, provider });
			} catch (error) {
				rpc.artifacts(join(repoRoot, "artifacts", "e2e", name));
				throw error;
			} finally {
				await rpc.stop();
				await provider.close();
				isolated.cleanup();
			}
		},
	};
}

describe("e2e: recovery", () => {
	it("resumes a done leg as exactly one follow-up row", { timeout: 60_000 }, async () => {
		const s = scenario("resume");
		await s.run(async ({ rpc, home }) => {
			await rpc.prompt("E2E_RESUME");
			await waitFor(
				() =>
					stateTasks(home).filter((task) => task.subagentName === "e2e-a").length === 2 &&
					stateTasks(home).every((task) => task.status !== "running"),
				"the follow-up row settles",
			);
			const rows = stateTasks(home).filter((task) => task.subagentName === "e2e-a");
			assert.equal(rows.length, 2, "the original and one follow-up, nothing else");
			const original = rows.find((task) => !task.description.startsWith("resume of"));
			const follow = rows.find((task) => task.description.startsWith("resume of"));
			if (!original || !follow) assert.fail("missing a resume row");
			assert.equal(original.status, "done");
			assert.equal(follow.description, `resume of ${original.taskId}`);
			assert.equal(follow.status, "done");
			assert.match(String(follow.result?.text), /RESUME_CHILD_DONE/);
			assert.notEqual(follow.taskId, original.taskId, "the follow-up has its own task id");
		});
	});

	it("settles the other leg when one fanout leg fails", { timeout: 60_000 }, async () => {
		const s = scenario("partial");
		await s.run(async ({ rpc, home }) => {
			await rpc.prompt("E2E_PARTIAL");
			await waitFor(
				() =>
					stateTasks(home).filter((task) => task.kind === "parallel").length === 2 &&
					stateTasks(home).every((task) => task.status !== "running"),
				"both fanout rows settled",
			);
			const rows = stateTasks(home).filter((task) => task.kind === "parallel");
			const failed = rows.find((task) => task.status === "error");
			const done = rows.find((task) => task.status === "done");
			if (!failed || !done) assert.fail("expected one failed and one done leg");
			assert.match(String(failed.error), /content|filter|stop/i);
			assert.match(String(done.result?.text), /PARTIAL_OK/);
			assert.equal(done.runId, failed.runId, "both legs share the fanout run");
		});
	});

	it(
		"leaves the later chain step pending when the chain is stopped",
		{ timeout: 60_000 },
		async () => {
			const s = scenario("chain-stop");
			await s.run(async ({ rpc, home, provider }) => {
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
			});
		},
	);
});
