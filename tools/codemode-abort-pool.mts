/**
 * pi-subagents: does an aborted subagent keep its codemode worker busy?
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function arg(name: string, fallback: string): string {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

const HOLD = Number(arg("hold", "20"));
const CWD = arg("cwd", process.cwd());

const SUB = `---
name: probe-abort
description: Probe worker for the abort case.
model: inherit
tools: execute
codemode: true
autonomy: inherit
---

You are a probe subagent. You have the codemode tool.
`;

const SCRIPT = `const s = await tools.bash({ command: "date +%s; sleep ${HOLD}" });
text(s.output);`;

const PROMPT = `Run exactly one codemode script. The script must be:

${SCRIPT}

Run it once. Then stop and report what the script printed.
Do not run anything else.`;

interface Host {
	ctx: unknown;
	cfg: unknown;
}

async function setup(): Promise<Host> {
	const pi = await import("@earendil-works/pi-coding-agent");
	const { loadSubagentFromContent } = await import("../src/infra/subagent-files.ts");
	const home = mkdtempSync(join(tmpdir(), "codemode-abort-"));
	const file = join(home, "probe-abort.md");
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
	return { ctx: { ui: {}, model, thinkingLevel: "off", modelRegistry } as never, cfg };
}

async function main(): Promise<void> {
	const pi = await import("@earendil-works/pi-coding-agent");
	const { startSubagentSession } = await import("../src/infra/host-session.ts");
	const { ctx, cfg } = await setup();

	const t0 = Date.now();
	const at = (): number => Date.now() - t0;

	let firstScriptStart = 0;
	const started = { resolve: (): void => {} };
	const scriptStarted = new Promise<void>((resolve) => {
		started.resolve = resolve;
	});
	const first = await startSubagentSession(cfg as never, CWD, ctx as never);
	first.session.subscribe((e: { type: string; toolName?: string }) => {
		if (e.type === "tool_execution_start" && e.toolName === "codemode") {
			firstScriptStart = at();
			started.resolve();
		}
	});
	const firstRun = first.session
		.prompt(PROMPT)
		.catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));

	await scriptStarted;
	await new Promise((resolve) => {
		setTimeout(resolve, 1500);
	});
	const abortedAt = at();
	first.session.abort();
	await new Promise((resolve) => {
		setTimeout(resolve, 500);
	});
	first.session.dispose();

	let secondScriptStart = 0;
	let secondScriptEnd = 0;
	let secondText = "";
	const second = await startSubagentSession(cfg as never, CWD, ctx as never);
	second.session.subscribe((e: { type: string; toolName?: string; result?: unknown }) => {
		if (e.type === "tool_execution_start" && e.toolName === "codemode") secondScriptStart = at();
		if (e.type === "tool_execution_end" && e.toolName === "codemode") {
			secondScriptEnd = at();
			const res = e.result as { content?: { type: string; text?: string }[] } | undefined;
			secondText = (res?.content ?? [])
				.filter((b) => b.type === "text")
				.map((b) => b.text ?? "")
				.join(" ");
		}
	});
	const secondRun = second.session
		.prompt(PROMPT)
		.catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));

	await Promise.all([firstRun, secondRun]);
	second.session.dispose();

	console.log(`host: ${(pi as unknown as { VERSION?: string }).VERSION ?? "unknown"}`);
	console.log(`leg 1: script started ${firstScriptStart}ms, aborted at ${abortedAt}ms`);
	console.log(
		`leg 2: script ${secondScriptStart}ms→${secondScriptEnd}ms (waited ${secondScriptStart - abortedAt}ms after the abort)`,
	);
	console.log(`leg 2 out: ${secondText.replace(/\s+/g, " ").slice(0, 200)}`);
	console.log(`limit hit: ${/worker limit reached/i.test(secondText) ? "yes" : "no"}`);
}

await main();
