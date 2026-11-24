/**
 * Full e2e: the child gate blocks a destructive call, and only when it is on.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeProvider } from "./fake-provider.ts";
import { createE2EHome, type E2EHome } from "./home.ts";
import { startRpc } from "./rpc.ts";

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

function hooks(home: E2EHome): Record<string, unknown>[] {
	if (!existsSync(home.hookPath)) return [];
	const text = readFileSync(home.hookPath, "utf8").trim();
	return text ? text.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) : [];
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

function journal(home: E2EHome): Record<string, unknown>[] {
	if (!existsSync(home.journalPath)) return [];
	return readFileSync(home.journalPath, "utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function resultText(task: Record<string, unknown>): string {
	const result = task.result as { text?: string } | undefined;
	return result?.text ?? "";
}

interface GateRun {
	report: string;
	deleted: boolean;
	target: string;
	home: E2EHome;
}

/** Run one gate scenario: one Task leg, one rm -rf on a real temp directory. */
async function runGate(token: string): Promise<GateRun> {
	let target = "";
	const provider = await startFakeProvider({
		commandFor: () => `rm -rf ${JSON.stringify(target)}`,
	});
	const home = createE2EHome({ baseUrl: provider.baseUrl, liveCap: 2 });
	target = join(home.dir, "gate-target");
	mkdirSync(target, { recursive: true });
	writeFileSync(join(target, "keep.txt"), "keep\n");
	const rpc = startRpc(home);
	try {
		await rpc.prompt(token);
		await waitFor(() => hooks(home).length >= 1, "gate leg hook");
		await waitFor(
			() =>
				stateTasks(home).some(
					(task) =>
						(task.subagentName === "e2e-gate" || task.subagentName === "e2e-nogate") &&
						task.status === "done",
				),
			"gate leg done",
		);
		const task = stateTasks(home).find(
			(row) => row.subagentName === "e2e-gate" || row.subagentName === "e2e-nogate",
		);
		assert.ok(task, "gate task row");
		return { report: resultText(task), deleted: !existsSync(target), target, home };
	} finally {
		await rpc.stop();
		await provider.close();
	}
}

describe("e2e: child gate", () => {
	it(
		"blocks a direct destructive call when gates are on and journals it",
		{ timeout: 120_000 },
		async () => {
			const run = await runGate("E2E_GATE_ON_DIRECT");
			try {
				assert.equal(run.deleted, false, "the file must survive a blocked rm -rf");
				assert.match(run.report, /gates: recursive delete \(bash\)/);
				const gates = journal(run.home).filter((line) => line.event === "gate");
				assert.deepEqual(gates, [
					{ event: "gate", tool: "bash", reason: "recursive delete (bash)" },
				]);
			} finally {
				run.home.cleanup();
			}
		},
	);

	it("lets the same call through when gates are off", { timeout: 120_000 }, async () => {
		const run = await runGate("E2E_GATE_OFF_DIRECT");
		try {
			assert.equal(run.deleted, true, "without the gate the rm -rf must run");
			assert.doesNotMatch(run.report, /gates:/);
			assert.equal(
				journal(run.home).filter((line) => line.event === "gate").length,
				0,
				"no gate line when the gate is off",
			);
		} finally {
			run.home.cleanup();
		}
	});

	it(
		"blocks a destructive call nested inside a codemode script",
		{ timeout: 120_000 },
		async () => {
			const run = await runGate("E2E_GATE_ON_NESTED");
			try {
				assert.equal(run.deleted, false, "a nested rm -rf must be blocked too");
				assert.match(run.report, /gates: recursive delete \(bash\)/);
				assert.ok(
					journal(run.home).some((line) => line.event === "gate"),
					"the nested block is journaled",
				);
			} finally {
				run.home.cleanup();
			}
		},
	);
});
