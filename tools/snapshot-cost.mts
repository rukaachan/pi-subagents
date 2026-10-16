/**
 * pi-subagents: what a history snapshot costs at Esc time.
 */

interface Msg {
	role: string;
	content: { type: string; text: string }[];
	usage?: { input: number; output: number };
}

function makeHistory(turns: number, chunkChars: number): Msg[] {
	const msgs: Msg[] = [];
	for (let i = 0; i < turns; i++) {
		msgs.push({
			role: "user",
			content: [{ type: "text", text: "Task: read and report.".padEnd(chunkChars, ".") }],
		});
		for (let k = 0; k < 4; k++) {
			msgs.push({
				role: "toolResult",
				content: [{ type: "text", text: `tool out ${k}`.padEnd(chunkChars, ".") }],
			});
		}
		msgs.push({
			role: "assistant",
			content: [{ type: "text", text: "working".padEnd(Math.floor(chunkChars / 4), ".") }],
			usage: { input: 4000, output: 200 },
		});
	}
	return msgs;
}

function timeCopy(msgs: Msg[]): number {
	const t0 = process.hrtime.bigint();
	const copy = JSON.parse(JSON.stringify(msgs)) as Msg[];
	const t1 = process.hrtime.bigint();
	if (!Array.isArray(copy)) throw new Error("copy failed");
	return Number(t1 - t0) / 1e6;
}

const shapes: Array<{ name: string; turns: number; chunk: number }> = [
	{ name: "short leg (10 turns, 2KB chunks)", turns: 10, chunk: 2000 },
	{ name: "longest real leg (70 turns, 4KB chunks)", turns: 70, chunk: 4000 },
	{ name: "heavy leg (70 turns, 20KB chunks)", turns: 70, chunk: 20_000 },
	{ name: "worst case (200 turns, 40KB chunks)", turns: 200, chunk: 40_000 },
];

for (const shape of shapes) {
	const msgs = makeHistory(shape.turns, shape.chunk);
	const bytes = Buffer.byteLength(JSON.stringify(msgs), "utf8");
	timeCopy(msgs);
	const samples = Array.from({ length: 9 }, () => timeCopy(msgs)).toSorted((a, b) => a - b);
	const median = samples[Math.floor(samples.length / 2)] ?? 0;
	console.log(
		`${shape.name.padEnd(42)} ${(bytes / 1024).toFixed(0).padStart(6)}KB  copy ${median.toFixed(1)}ms  (max ${(samples.at(-1) ?? 0).toFixed(1)}ms)`,
	);
}
