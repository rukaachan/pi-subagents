/**
 * pi-subagents: what the viewer and state save cost, before and after.
 */
import { performance } from "node:perf_hooks";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { transcriptEntries } from "../src/telemetry/transcript.ts";
import { createSessionView } from "../src/ui/view/session-screen.ts";
import { capRecord } from "../src/infra/state-file.ts";
import type { TaskRecord } from "../src/domain/task/index.ts";

const WIDTH = 120;
const HISTORY = 1500;

function makeMessage(i: number): unknown {
	const kind = i % 3;
	if (kind === 0) return { role: "user", content: `Task step ${i}` };
	if (kind === 1) {
		return {
			role: "assistant",
			content: [
				{ type: "text", text: `Answer ${i} ${"lorem ipsum ".repeat(120)}` },
				{ type: "toolCall", name: "bash", arguments: { command: `printf ${i}` } },
			],
		};
	}
	return {
		role: "toolResult",
		toolName: "bash",
		isError: false,
		content: [{ type: "text", text: `line ${i}\n`.repeat(200) }],
	};
}

function makeHistory(count: number): unknown[] {
	return Array.from({ length: count }, (_, i) => makeMessage(i));
}

function ms(fn: () => void, runs = 5): number {
	const samples: number[] = [];
	for (let i = 0; i < runs; i += 1) {
		const started = performance.now();
		fn();
		samples.push(performance.now() - started);
	}
	samples.sort((a, b) => a - b);
	return samples[Math.floor(samples.length / 2)] ?? 0;
}

function legacyPaint(messages: unknown[]): number {
	const entries = transcriptEntries(messages);
	let rows = 0;
	for (const entry of entries) {
		const wrapped = entry.text ? wrapTextWithAnsi(entry.text, WIDTH - 16) : [""];
		rows += wrapped.length;
	}
	return rows;
}

function viewFor(source: () => readonly unknown[], streaming: () => unknown) {
	return createSessionView({
		title: "bench",
		stats: () => "RUNNING · 1t",
		source,
		height: () => 40,
		theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text },
		empty: "",
		render: () => undefined,
		onClose: () => undefined,
		streaming,
	});
}

function table(title: string, rows: [string, string][]): void {
	console.log(`\n${title}`);
	const width = rows.reduce((n, [key]) => Math.max(n, key.length), 0);
	for (const [key, value] of rows) console.log(`  ${key.padEnd(width)}  ${value}`);
}

const history = makeHistory(HISTORY);
const shapeFull = ms(() => transcriptEntries(history));

const cursorMessages = makeHistory(HISTORY);
const cursorView = viewFor(
	() => cursorMessages,
	() => undefined,
);
cursorView.render(WIDTH);
const shapeAppend = ms(() => {
	cursorMessages.push(makeMessage(cursorMessages.length));
	cursorView.sync();
	cursorView.render(WIDTH);
}, 20);

const legacyRows = legacyPaint(history);
const paintFull = ms(() => legacyPaint(history));

const tickMessages = makeHistory(HISTORY);
const tickView = viewFor(
	() => tickMessages,
	() => undefined,
);
tickView.render(WIDTH);
const tick = ms(() => {
	tickMessages.push(makeMessage(tickMessages.length));
	tickView.sync();
	tickView.render(WIDTH);
}, 20);

const live = { role: "assistant", content: [{ type: "text", text: "x".repeat(4000) }] };
const streamMessages = makeHistory(20);
const streamView = viewFor(
	() => streamMessages,
	() => live,
);
streamView.render(WIDTH);
const streamFrame = ms(() => {
	live.content[0] = { type: "text", text: `x${"y".repeat(4000 + Math.floor(Math.random() * 8))}` };
	streamView.sync();
	streamView.render(WIDTH);
}, 20);

const records = Array.from({ length: 20 }, (_, i) => ({
	taskId: `task-${i}`,
	history: Array.from({ length: 60 }, (k) => ({
		role: k % 2 ? "assistant" : "toolResult",
		content: [{ type: "text", text: `${"x".repeat(400)}\n`.repeat(8) }],
	})),
})) as unknown as TaskRecord[];
const freshSets = Array.from(
	{ length: 3 },
	() => JSON.parse(JSON.stringify(records)) as TaskRecord[],
);
const saveCold = ms(() => {
	const fresh = freshSets.pop();
	for (const rec of fresh ?? []) capRecord(rec);
}, 3);
const saveWarm = ms(() => {
	for (const rec of records) capRecord(rec);
}, 5);

table("shape (1500 messages)", [
	["old: every tick", `${shapeFull.toFixed(1)} ms`],
	["new: one appended message", `${shapeAppend.toFixed(2)} ms`],
	["factor", `${(shapeFull / Math.max(shapeAppend, 0.01)).toFixed(0)}x`],
]);
table("paint (400 entries)", [
	["old: every message", `${paintFull.toFixed(1)} ms (${legacyRows} rows)`],
	["new: one appended message", `${tick.toFixed(2)} ms`],
	["factor", `${(paintFull / Math.max(tick, 0.01)).toFixed(0)}x`],
]);
table("streaming", [["one 4 KB frame", `${streamFrame.toFixed(2)} ms`]]);
table("state save (20 tasks, 60 messages each)", [
	["cold", `${saveCold.toFixed(1)} ms`],
	["warm", `${saveWarm.toFixed(2)} ms`],
	["factor", `${(saveCold / Math.max(saveWarm, 0.01)).toFixed(0)}x`],
]);
