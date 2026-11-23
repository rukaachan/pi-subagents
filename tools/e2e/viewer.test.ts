/**
 * Full e2e: the session viewer's 10-line preview and expansion.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { startFakeProvider } from "./fake-provider.ts";
import { createE2EHome } from "./home.ts";
import { createSessionView } from "../../src/ui/view/session-screen.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const LONG = Array.from({ length: 40 }, (_, i) => `LONG line ${i + 1}`).join("\n");
const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

initTheme("dark", false);

const theme = { fg: (_token: string, text: string) => text, bold: (text: string) => text };

function viewer() {
	return createSessionView({
		title: "✓ e2e-long · cur5e6",
		stats: () => "DONE",
		source: () => [
			{ role: "user", content: "Task: E2E_LONG" },
			{
				role: "toolResult",
				toolName: "read",
				isError: false,
				content: [{ type: "text", text: LONG }],
			},
		],
		height: () => 52,
		theme: theme as never,
		empty: "",
		render: () => {},
		onClose: () => {},
	});
}

function hasTmux(): boolean {
	try {
		execFileSync("tmux", ["-V"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function tmux(args: string[]): string {
	return execFileSync("tmux", args, { encoding: "utf8" });
}

function capture(session: string): string {
	try {
		return tmux(["capture-pane", "-p", "-t", session]);
	} catch {
		return "";
	}
}

async function waitForText(session: string, text: string, timeoutMs = 20_000): Promise<string> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const pane = capture(session);
		if (pane.includes(text)) return pane;
		await sleep(150);
	}
	throw new Error(`tmux pane never showed ${text}`);
}

describe("e2e: viewer", () => {
	it("previews 40 result lines as 10, then expands with ctrl+o", () => {
		const view = viewer();
		const preview = view.render(100).join("\n");
		assert.equal(preview.match(/LONG line/g)?.length, 10);
		assert.match(preview, /\(30 more lines, ctrl\+o to expand\)/);
		assert.doesNotMatch(preview, /LONG line 11/);

		view.handleInput("\x0f");
		const expanded = view.render(100).join("\n");
		assert.equal(expanded.match(/LONG line/g)?.length, 40);
		assert.doesNotMatch(expanded, /more lines, ctrl\+o/);
	});

	it(
		"opens the real TUI viewer and expands the body",
		{ skip: process.env.E2E_TUI !== "1" || !hasTmux() },
		async () => {
			const provider = await startFakeProvider();
			const home = createE2EHome({ baseUrl: provider.baseUrl, liveCap: 2 });
			const session = `e2e-view-${process.pid}`;
			try {
				const env = `HOME=${home.dir} PI_SUBAGENTS_JOURNAL=${home.journalPath}`;
				execFileSync(
					"tmux",
					[
						"new-session",
						"-d",
						"-s",
						session,
						"-x",
						"110",
						"-y",
						"50",
						"-c",
						repoRoot,
						`${env} ${process.env.PI_BIN ?? "pi"} -a -ne -e ./extensions/index.ts -nc -ns -np --no-session --no-mcp`,
					],
					{ encoding: "utf8" },
				);
				await waitForText(session, "(e2e) e2e");
				tmux(["send-keys", "-t", session, "/delegate @e2e-long E2E_LONG", "Enter"]);
				await waitForText(session, "e2e-long");
				for (let i = 0; i < 100 && !existsSync(home.hookPath); i += 1) await sleep(100);
				tmux(["send-keys", "-t", session, "/delegate open e2e-long", "Enter"]);
				const preview = await waitForText(session, "more lines");
				assert.match(preview, /LONG line 10/);
				assert.doesNotMatch(preview, /LONG line 11/);
				tmux(["send-keys", "-t", session, "C-o"]);
				const full = await waitForText(session, "LONG line 40");
				assert.match(full, /LONG line 40/);
				assert.doesNotMatch(full, /more lines/);
			} finally {
				try {
					tmux(["kill-session", "-t", session]);
				} catch {
					/* already gone */
				}
				await provider.close();
				home.cleanup();
			}
		},
	);
});
