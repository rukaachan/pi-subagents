/**
 * Render the session viewer without a terminal, so a broken frame shows up
 * in CI instead of in a live run.
 *
 * Run: node --experimental-strip-types tools/session-view-probe.mts
 */
import { fileURLToPath } from "node:url";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createSessionView } from "../src/ui/view/session-screen.ts";

initTheme("dark", false);

const theme = {
	fg: (_token: string, text: string) => text,
	bold: (text: string) => text,
};

const MESSAGES = [
	{ role: "user", content: "Task: map the rust engine and report the entry points" },
	{
		role: "assistant",
		content: [
			{ type: "text", text: "Looking at the crate layout first, then the public API." },
			{ type: "toolCall", name: "codemode", arguments: { code: "ls /rust/engine" } },
		],
	},
	{
		role: "toolResult",
		toolName: "codemode",
		isError: false,
		content: [{ type: "text", text: "engine\norderbook\nrisk\nbacktest" }],
	},
	{
		role: "toolResult",
		toolName: "bash",
		isError: true,
		content: [{ type: "text", text: "cargo: command not found" }],
	},
	{
		role: "assistant",
		content: [
			{
				type: "text",
				text: "The engine module owns matching and the order book; risk reads fills. This sentence is long on purpose, to prove the viewer wraps instead of clipping.",
			},
		],
	},
];

const LONG_RESULT = Array.from({ length: 40 }, (_, i) => `LONG line ${i + 1}`).join("\n");
const LONG_MESSAGES = [
	...MESSAGES,
	{
		role: "toolResult",
		toolName: "read",
		isError: false,
		content: [{ type: "text", text: LONG_RESULT }],
	},
];

const LIVE = {
	role: "assistant",
	content: [{ type: "text", text: "Streaming line one.\n".repeat(100) }],
};

interface Case {
	label: string;
	width: number;
	height: number;
	keys?: string[];
	streaming?: () => unknown;
	messages?: unknown[];
	append?: number;
	expect?: string;
}

const CASES: Case[] = [
	{ label: "history", width: 80, height: 24 },
	{ label: "small", width: 40, height: 10 },
	{ label: "streaming", width: 80, height: 24, streaming: () => LIVE },
	{ label: "scrolled", width: 80, height: 24, keys: ["g", "\x1b[6~"] },
	{ label: "new-while-away", width: 60, height: 12, keys: ["k"], append: 2, expect: "↓2 new" },
	{
		label: "long-result",
		width: 100,
		height: 52,
		messages: LONG_MESSAGES,
		expect: "30 more lines",
	},
	{
		label: "long-expanded",
		width: 100,
		height: 52,
		messages: LONG_MESSAGES,
		keys: [""],
		expect: "LONG line 40",
	},
];

export function checkFrames(quiet = false): string[] {
	const bad: string[] = [];
	for (const spec of CASES) {
		const messages = [...(spec.messages ?? MESSAGES)];
		const view = createSessionView({
			title: "… worker · cur5e6",
			stats: () => "RUNNING · 3t · codemode · 18s",
			source: () => messages,
			height: () => spec.height,
			theme: theme as never,
			empty: "waiting for the first message…",
			render: () => {},
			onClose: () => {},
			...(spec.streaming ? { streaming: spec.streaming } : {}),
		});
		view.render(spec.width);
		for (const key of spec.keys ?? []) view.handleInput(key);
		for (let i = 0; i < (spec.append ?? 0); i += 1) {
			messages.push({ role: "user", content: `fresh ${i}` });
		}
		view.sync();
		const lines = view.render(spec.width);
		if (!quiet) {
			console.log(`\n── ${spec.label} ${spec.width}×${spec.height} ──`);
			for (const line of lines) console.log(`|${line}`);
		}
		const wide = lines.filter((line) => visibleWidth(line) > spec.width);
		if (lines.length !== spec.height) {
			bad.push(`${spec.label}: ${lines.length} lines`);
		}
		if (wide.length > 0) bad.push(`${spec.label}: ${wide.length} lines too wide`);
		if (spec.expect && !lines.some((line) => line.includes(spec.expect))) {
			bad.push(`${spec.label}: missing "${spec.expect}"`);
		}
	}
	return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const bad = checkFrames();
	if (bad.length > 0) {
		console.error(`frame is wrong: ${bad.join("; ")}`);
		process.exitCode = 1;
	}
}
