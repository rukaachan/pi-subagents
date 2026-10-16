/**
 * pi-subagents: how many codemode scripts can hold a worker at once?
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function arg(name: string, fallback: string): string {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

const LEGS = Number(arg("legs", "3"));
const BARRIER = Number(arg("barrier", "25"));
const CWD = arg("cwd", process.cwd());

const SUB = `---
name: probe-coder
description: Probe worker that holds one codemode worker.
model: inherit
tools: execute
codemode: true
autonomy: inherit
---

You are a probe subagent. You have the codemode tool.
`;

const barrierAt = Math.floor(Date.now() / 1000) + BARRIER;
const SCRIPT = `const r = await tools.bash({ command: "date +%s; while [ $(date +%s) -lt ${barrierAt} ]; do sleep 0.3; done; echo released" });
text(r.output);`;

const PROMPT = `Run exactly one codemode script. The script must be:

${SCRIPT}

Run it once. Then stop and report the single line the script printed.
Do not run anything else.`;

interface Leg {
	leg: number;
	startedAt: number;
	scriptStartedAt?: number;
	scriptEndedAt?: number;
	scriptText?: string;
	error?: string;
	limitHit: boolean;
}

async function main(): Promise<void> {
	const pi = await import("@earendil-works/pi-coding-agent");
	const { loadSubagentFromContent } = await import("../src/infra/subagent-files.ts");
	const { startSubagentSession } = await import("../src/infra/host-session.ts");
	// The extension sets the pool when pi loads it. The probe loads the
	// same wiring, so it measures what the package actually ships.
	const { applyCodemodeWorkerDefault } = await import("../src/infra/worker-pool.ts");
	applyCodemodeWorkerDefault();
	console.log(`workers: ${process.env.PI_CODEMODE_MAX_WORKERS}`);

	const home = mkdtempSync(join(tmpdir(), "codemode-probe-"));
	const file = join(home, "probe-coder.md");
	writeFileSync(file, SUB, "utf8");
	const cfg = loadSubagentFromContent(readFileSync(file, "utf8"), file, "user");
	if (typeof cfg === "string") throw new Error(`fixture did not parse: ${cfg}`);

	type AnyRegistry = { find(provider: string, id: string): unknown };
	const runtime = await (
		pi as unknown as { ModelRuntime: { create(): Promise<unknown> } }
	).ModelRuntime.create();
	const modelRegistry = new (
		pi as unknown as { ModelRegistry: new (r: unknown) => AnyRegistry }
	).ModelRegistry(runtime);

	const candidates = [
		["opencode-zen-responses", "glm-5.3-flash-free"],
		["opencode-zen-responses", "deepseek-v4.1-flash-free"],
		["opencode-zen", "glm-5.3-flash-free"],
	];
	let model: unknown;
	for (const [provider, id] of candidates) {
		const found = modelRegistry.find(provider, id);
		if (found) {
			model = found;
			break;
		}
	}
	if (!model) throw new Error("no probe model resolved");
	const ctx = { ui: {}, model, thinkingLevel: "off", modelRegistry } as never;

	const legs: Leg[] = [];
	const t0 = Date.now();
	const runs = Array.from({ length: LEGS }, (_, i) =>
		(async (): Promise<void> => {
			const leg: Leg = { leg: i + 1, startedAt: Date.now() - t0, limitHit: false };
			legs.push(leg);
			const child = await startSubagentSession(cfg, CWD, ctx);
			child.session.subscribe((e: { type: string; toolName?: string; result?: unknown }) => {
				if (e.type === "tool_execution_start" && e.toolName === "codemode") {
					leg.scriptStartedAt = Date.now() - t0;
				}
				if (e.type === "tool_execution_end" && e.toolName === "codemode") {
					leg.scriptEndedAt = Date.now() - t0;
					const res = e.result as { content?: { type: string; text?: string }[] } | undefined;
					leg.scriptText = (res?.content ?? [])
						.filter((b) => b.type === "text")
						.map((b) => b.text ?? "")
						.join(" ");
				}
			});
			try {
				await child.session.prompt(PROMPT);
			} catch (err) {
				leg.error = err instanceof Error ? err.message : String(err);
			}
			// Host 1.3.0 said "worker limit reached"; host 1.4.0 waits and
			// then says "no codemode worker became free within 60 seconds".
			// Both are the same wall: the pool had no worker free.
			leg.limitHit =
				/worker limit reached/i.test(leg.scriptText ?? "") ||
				/worker limit reached/i.test(leg.error ?? "") ||
				/no codemode worker became free/i.test(leg.scriptText ?? "") ||
				/no codemode worker became free/i.test(leg.error ?? "");
			child.session.dispose();
		})(),
	);

	await Promise.all(runs);
	rmSync(home, { recursive: true, force: true });

	console.log(`host: ${(pi as unknown as { VERSION?: string }).VERSION ?? "unknown"}`);
	console.log(`legs: ${LEGS}  barrier: ${BARRIER}s (all scripts hold until it)`);
	for (const leg of legs.toSorted((a, b) => a.leg - b.leg)) {
		const started = leg.scriptStartedAt ?? -1;
		const ended = leg.scriptEndedAt ?? -1;
		const ranAt = Number((leg.scriptText ?? "").match(/\b(\d{10})\b/)?.[1] ?? "0") * 1000;
		const waited = ranAt > 0 && started >= 0 ? ranAt - t0 - started : -1;
		console.log(
			`leg ${leg.leg}: script ${started >= 0 ? `${started}ms→${ended}ms` : "never ran"}` +
				`${waited >= 0 ? `  waited ${Math.round(waited / 1000)}s for a worker` : ""}` +
				`${leg.limitHit ? "  LIMIT REACHED" : ""}` +
				`${leg.error ? `  error: ${leg.error.slice(0, 160)}` : ""}` +
				`${leg.scriptText ? `  out: ${leg.scriptText.replace(/\s+/g, " ").slice(0, 160)}` : ""}`,
		);
	}
	const failed = legs.filter((l) => l.limitHit).length;
	console.log(`legs that hit the worker limit: ${failed}/${LEGS}`);
}

await main();
