/**
 * Full e2e: a child loads MCP and calls a real stdio server through codemode.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeProvider } from "./fake-provider.ts";
import { createE2EHome, type E2EHome } from "./home.ts";
import { startRpc } from "./rpc.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

async function waitFor(check: () => boolean, label: string, timeoutMs = 60_000): Promise<void> {
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

function resultText(task: Record<string, unknown>): string {
	const result = task.result as { text?: string } | undefined;
	return result?.text ?? "";
}

describe("e2e: MCP", () => {
	it("runs a real stdio MCP tool from a child script", { timeout: 120_000 }, async () => {
		const provider = await startFakeProvider();
		const home = createE2EHome({ baseUrl: provider.baseUrl, liveCap: 2 });
		writeFileSync(
			join(home.agentDir, "mcp.json"),
			`${JSON.stringify({
				mcpServers: {
					echo: {
						command: process.execPath,
						args: [join(repoRoot, "tests", "fixtures", "mcp-echo-server.mjs")],
					},
				},
			})}\n`,
		);
		const rpc = startRpc(home);
		try {
			await rpc.prompt("E2E_MCP");
			await waitFor(() => hooks(home).length >= 1, "mcp leg hook");
			await waitFor(
				() =>
					stateTasks(home).some(
						(task) => task.subagentName === "e2e-mcp" && task.status === "done",
					),
				"mcp leg done",
			);
			const task = stateTasks(home).find((row) => row.subagentName === "e2e-mcp");
			assert.ok(task, "mcp task row");
			assert.match(resultText(task), /MCP_PROVEN/);
			assert.ok(
				provider.requests.some((req) => JSON.stringify(req.body).includes("MCP_PROVEN")),
				"the child reached the model with the MCP result",
			);
		} finally {
			await rpc.stop();
			await provider.close();
			home.cleanup();
		}
	});
});
