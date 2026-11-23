/**
 * Full e2e: chain, parallel fanout, and abort.
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

function resultText(event: { raw: Record<string, unknown> }): string {
	const result = event.raw.result as { content?: { text?: string }[] } | undefined;
	return (result?.content ?? []).map((part) => part.text ?? "").join("\n");
}

function scenario(name: string) {
	const server = startFakeProvider();
	const home: Promise<E2EHome> = server.then((s) =>
		createE2EHome({ baseUrl: s.baseUrl, liveCap: 12 }),
	);
	let rpc: PiRpc | undefined;
	return {
		server,
		home,
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

describe("e2e: chain and parallel", () => {
	it(
		"runs a two-step chain and exposes the first step to the second",
		{ timeout: 60_000 },
		async () => {
			const s = scenario("chain");
			await s.run(async ({ rpc, home }) => {
				const from = rpc.events.length;
				await rpc.prompt("E2E_CHAIN");
				const taskEnd = await rpc.waitForEvent(
					(event) => event.type === "tool_execution_end" && event.raw.toolName === "Task",
					"Task tool end",
					20_000,
					from,
				);
				const body = resultText(taskEnd);
				assert.match(body, /STEP1/);
				assert.match(body, /STEP2/);

				await waitFor(() => hooks(home).length >= 2, "two chain hooks");
				const lines = hooks(home);
				assert.deepEqual(lines.map((line) => line.subagent).toSorted(), ["e2e-a", "e2e-b"]);
				assert.ok(lines.every((line) => line.status === "done"));

				const runs = journal(home).filter((event) => event.event === "run_start");
				assert.equal(runs.length, 2);
				assert.ok(runs.every((event) => event.kind === "chain"));

				await waitFor(
					() => stateTasks(home).some((task) => task.kind === "chain" && task.status === "done"),
					"chain state record",
				);
				const record = stateTasks(home).find((task) => task.kind === "chain");
				assert.equal(record?.status, "done");
				assert.match(
					String((record?.result as { text?: string } | undefined)?.text ?? ""),
					/STEP2/,
				);
			});
		},
	);

	it("fans one prompt out to two parallel legs", { timeout: 60_000 }, async () => {
		const s = scenario("parallel");
		await s.run(async ({ rpc, home }) => {
			const from = rpc.events.length;
			await rpc.prompt("E2E_PARALLEL");
			const taskEnd = await rpc.waitForEvent(
				(event) => event.type === "tool_execution_end" && event.raw.toolName === "Task",
				"Task tool end",
				20_000,
				from,
			);
			const body = resultText(taskEnd);
			assert.match(body, /Started 2 parallel legs/);
			assert.match(body, /task-[a-z0-9]+-\d+/);

			await waitFor(() => hooks(home).length >= 2, "two parallel hooks");
			const lines = hooks(home);
			assert.deepEqual(lines.map((line) => line.subagent).toSorted(), ["e2e-a", "e2e-b"]);
			assert.ok(lines.every((line) => line.status === "done"));

			await waitFor(
				() =>
					stateTasks(home).filter((task) => task.kind === "parallel").length === 2 &&
					stateTasks(home).every((task) => task.status === "done"),
				"two done parallel records",
			);
			const tasks = stateTasks(home).filter((task) => task.kind === "parallel");
			assert.equal(tasks.length, 2);
			assert.ok(tasks.every((task) => task.status === "done"));
		});
	});

	it("aborts a foreground leg without leaving a live run", { timeout: 60_000 }, async () => {
		const s = scenario("abort");
		await s.run(async ({ rpc, home, provider }) => {
			const from = rpc.events.length;
			await rpc.request({ type: "prompt", message: "E2E_ABORT" });
			await rpc.waitForEvent(
				(event) => event.type === "tool_execution_start" && event.raw.toolName === "Task",
				"Task tool start",
				20_000,
				from,
			);
			await waitFor(
				() => provider.requests.some((request) => request.prompt.includes("E2E_SLOW")),
				"slow child request",
			);
			await rpc.waitForStatus(/⇄/, 10_000, from);
			const asked = provider.requests.length;
			const started = Date.now();
			const cut = rpc.events.length;
			await rpc.request({ type: "abort" });
			const settled = await rpc.waitForEvent(
				(event) => event.type === "agent_settled",
				"agent settled after abort",
				10_000,
				from,
			);
			assert.equal(settled.raw.aborted, true);
			assert.ok(Date.now() - started < 3000, "abort returned quickly");

			const end = await rpc.waitForEvent(
				(event) => event.type === "tool_execution_end" && event.raw.toolName === "Task",
				"Task tool end after abort",
				10_000,
				from,
			);
			assert.equal(end.raw.isError, true);
			assert.ok(provider.requests.length >= asked);
			await sleep(600);
			assert.ok(!hooks(home).some((line) => line.status === "done"), "aborted child is not done");
			assert.ok(
				!stateTasks(home).some((task) => task.status === "running"),
				"no running state row survives abort",
			);
			const footerAfter = rpc.events
				.slice(cut)
				.filter((event) => event.type === "setStatus")
				.map((event) => String(event.raw.statusText ?? ""));
			assert.ok(
				!footerAfter.some((text) => text.includes("⇄")),
				"the footer stops claiming a live leg",
			);
			assert.ok(
				footerAfter.some((text) => text.includes("⊘")),
				"the footer books the stop",
			);
		});
	});
});
