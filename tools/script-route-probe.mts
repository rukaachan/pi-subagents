/**
 * pi-subagents: a subagent with a plain prompt and no codemode flag.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const TARGET = "/home/taufik/Documents/Tech/opencode-relay";

const SUB = `---
name: plain-worker
description: A probe subagent with a plain prompt.
model: inherit
tools: execute
autonomy: inherit
---

You are a subagent with a fresh context. Read the code before you change it.
`;

const TASKS: Record<string, string> = {
	inventory: `Task: list every place in internal/ that mentions \`terse400\`, with the file and the line number. Then run: go build ./...`,
	rename: `Task: in internal/zen/upstream_error.go, rename the parameter \`status\` of the function \`terse400\` to \`statusCode\`, and update every use of it inside that function. Change nothing else. Then run: go build ./...`,
};

const argv = process.argv.slice(2);
const task = argv.includes("--task") ? (argv[argv.indexOf("--task") + 1] as string) : "inventory";

async function main(): Promise<void> {
	const pi = await import("@earendil-works/pi-coding-agent");
	const { loadSubagentFromContent } = await import("../src/infra/subagent-files.ts");
	const { startSubagentSession } = await import("../src/infra/host-session.ts");

	const work = mkdtempSync(join(tmpdir(), "script-route-"));
	try {
		execFileSync("bash", [
			"-c",
			`cp -r ${TARGET}/internal ${work}/ && mkdir -p ${work}/cmd && cp -r ${TARGET}/cmd/* ${work}/cmd/ 2>/dev/null; cp ${TARGET}/go.mod ${work}/ 2>/dev/null; true`,
		]);
		mkdirSync(join(work, ".agents"), { recursive: true });
		const file = join(work, ".agents", "plain-worker.md");
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
		const model = modelRegistry.find("opencode-zen-responses", "deepseek-v4.1-flash-free") as never;
		const ctx = { ui: {}, model, thinkingLevel: "off", modelRegistry } as never;

		const tools: string[] = [];
		let turns = 0;
		const start = Date.now();
		const child = await startSubagentSession(cfg, work, ctx);
		child.session.subscribe((e: { type: string; toolName?: string }) => {
			if (e.type === "tool_execution_start" && e.toolName) tools.push(e.toolName);
			if (e.type === "turn_end") turns += 1;
		});
		await child.session.prompt(
			`Work in the repo at the current directory (Go, module opencode-relay).\n\n${TASKS[task] ?? TASKS.inventory}\n\nReport what the task asks for, then the build output.`,
		);
		const text = child.session.getLastAssistantText() ?? "";
		const systemPrompt = child.session.systemPrompt;
		console.log(
			JSON.stringify({
				elapsedSec: Math.round((Date.now() - start) / 1000),
				turns,
				toolCalls: tools.length,
				codemodeCalls: tools.filter((t) => t === "codemode").length,
				activeTools: child.session.getActiveToolNames().join(","),
				routeTaught: /inside codemode scripts/.test(systemPrompt),
				mentions: (text.match(/terse400|statusCode/g) ?? []).length,
				reportChars: text.length,
			}),
		);
		child.session.dispose();
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

await main();
