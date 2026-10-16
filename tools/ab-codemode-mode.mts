/**
 * pi-subagents: A/B/C: bare tools, codemode beside them, or codemode alone.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const TARGET = "/home/taufik/Documents/Tech/opencode-relay";

const SUB = `---
name: ab-mode-worker
description: A/B/C probe worker.
model: inherit
tools: execute
{{CODEMODE}}autonomy: inherit
---

You are the worker subagent. You run in a fresh context with the execute tool set{{TAIL}}.

{{BODY}}
`;

const BARE_BODY = `Method:
- Read the code before you change it. Know the call sites you will break.
- Change the smallest thing that makes the task work.

Method order: use bare tool calls (bash, read, edit) one at a time. One call per turn.`;

const SCRIPT_BODY = `Method:
- Batch independent reads and searches into ONE codemode script with Promise.allSettled. Keep edits and writes as their own calls.
- Read the code before you change it. Know the call sites you will break.
- Change the smallest thing that makes the task work.

Script rules:
- tools.bash resolves even when the command fails (failed exit lands in value.exit_code). Guard it: r.status === "fulfilled" && r.value.exit_code === 0 before reading r.value.output.
- Write literal calls inside Promise.allSettled. Keep 2-6 execs per script.
- If a result says "Script failed": the return value never ran. Read the error text, fix the code, retry once.`;

const TASKS: Record<string, string> = {
	inventory: `Task: build an inventory of every place in internal/ (all packages) that mentions \`terse400\` or \`replayTerse4xx\`.

For EACH mention, report one line: path:line, the enclosing function, and what that line does (3-12 words).

Do not change any file. Then verify the tree still builds with: go build ./...`,
	perfile: `Task: open EACH Go file in internal/zen/ one by one (every .go file, tests included) and report, for each: its filename, its package line, and its total line count. Read each file's contents — do not infer from names.

Do not change any file. Then verify the tree still builds with: go build ./...`,
	rename: `Task: in internal/zen/upstream_error.go, rename the parameter \`status\` of the function \`terse400\` to \`statusCode\`, and update every use of it inside that function. Change nothing else.

Then run: go build ./... and go test ./internal/zen/... and report both outputs.`,
};

function promptText(): string {
	const task = TASKS[process.env.AB_TASK ?? "inventory"] ?? TASKS.inventory;
	return `Work in the repo at the current directory (Go, module opencode-relay).\n\n${task}\n\nReport what the task asks for, then the build output.`;
}

type ArmName = "bare" | "on" | "only";

interface Arm {
	name: ArmName;
	/** The frontmatter value: none, `true` (beside the tools), `only` (alone). */
	codemode: "" | "true" | "only";
	body: string;
	tail: string;
	starter?: string;
}

const ARMS: Arm[] = [
	{ name: "bare", codemode: "", body: BARE_BODY, tail: "" },
	{ name: "on", codemode: "true", body: SCRIPT_BODY, tail: " and codemode" },
	{ name: "only", codemode: "only", body: SCRIPT_BODY, tail: " and codemode" },
	// The shipped starter, measured as it ships.
	{ name: "starter", codemode: "", body: "", tail: "", starter: "subagents/worker.md" },
];

function writeFixture(dir: string, arm: Arm): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "ab-mode-worker.md");
	if (arm.starter) {
		copyFileSync(arm.starter, path);
		return path;
	}
	const content = SUB.replace("{{CODEMODE}}", arm.codemode ? `codemode: ${arm.codemode}\n` : "")
		.replace("{{TAIL}}", arm.tail)
		.replace("{{BODY}}", arm.body);
	writeFileSync(path, content, "utf8");
	return path;
}

async function runOne(arm: Arm, cwd: string, tag: string): Promise<Record<string, unknown>> {
	const pi = await import("@earendil-works/pi-coding-agent");
	const { loadSubagentFromContent } = await import("../src/infra/subagent-files.ts");
	const { startSubagentSession } = await import("../src/infra/host-session.ts");
	const { sumUsage } = await import("../src/domain/run-result.ts");

	const file = writeFixture(join(cwd, ".ab-agents"), arm);
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
	const child = await startSubagentSession(cfg, cwd, ctx);
	child.session.subscribe((e: { type: string; toolName?: string }) => {
		if (e.type === "tool_execution_start" && e.toolName) tools.push(e.toolName);
		if (e.type === "turn_end") turns += 1;
	});
	try {
		await child.session.prompt(promptText());
		const usage = sumUsage(child.session.messages);
		let { input, output } = usage;
		if (input === 0 && output === 0) {
			for (const m of child.session.messages ?? []) {
				const u = (m as { usage?: { input?: number; output?: number } }).usage;
				if (u) {
					input += u.input ?? 0;
					output += u.output ?? 0;
				}
			}
		}
		const text = child.session.getLastAssistantText() ?? "";
		const allText = (child.session.messages ?? [])
			.filter((m: { role?: string }) => m.role === "assistant")
			.map((m: { content?: { type?: string; text?: string }[] }) =>
				(m.content ?? [])
					.filter((b) => b.type === "text")
					.map((b) => b.text ?? "")
					.join("\n"),
			)
			.join("\n");
		const direct = tools.filter((t) => t !== "codemode").length;
		const row = {
			arm: arm.name,
			tag,
			elapsedSec: Math.round((Date.now() - start) / 1000),
			turns,
			toolCalls: tools.length,
			toolsPerTurn: turns ? +(tools.length / turns).toFixed(2) : 0,
			codemodeCalls: tools.filter((t) => t === "codemode").length,
			directCalls: direct,
			activeTools: child.session.getActiveToolNames().join(","),
			input,
			output,
			usd: +((input / 1e6) * 3 + (output / 1e6) * 15).toFixed(4),
			reportChars: text.length,
			allTextChars: allText.length,
			mentions: (allText.match(/terse400|replayTerse4xx/gi) ?? []).length,
			reported: (allText.match(/internal\/[\w./-]+\.go:\d+/g) ?? []).length,
			buildOk: /ok\s+opencode-relay|PASS|ok\s+"/.test(allText),
			finalText: text.slice(0, 900).replace(/\s+/g, " "),
			edited: readFileSync(join(cwd, "internal/zen/upstream_error.go"), "utf8").includes(
				"func terse400(statusCode int",
			),
		};
		console.log(JSON.stringify(row));
		return row;
	} finally {
		child.session.dispose();
	}
}

const argv = process.argv.slice(2);
const legs = Number(argv[argv.indexOf("--legs") + 1] || 1);
const only = argv.includes("--arm") ? (argv[argv.indexOf("--arm") + 1] as ArmName) : "all";
const task = argv.includes("--task") ? (argv[argv.indexOf("--task") + 1] as string) : "inventory";
process.env.AB_TASK = task;
const tag = argv.includes("--tag")
	? (argv[argv.indexOf("--tag") + 1] as string)
	: new Date().toISOString().slice(11, 19);

const rows: Record<string, unknown>[] = [];
for (let i = 0; i < legs; i++) {
	for (const arm of ARMS) {
		if (only !== "all" && only !== arm.name) continue;
		const work = mkdtempSync(join(tmpdir(), `abc-${arm.name}-`));
		try {
			execFileSync("bash", [
				"-c",
				`cp -r ${TARGET}/internal ${work}/ && mkdir -p ${work}/cmd && cp -r ${TARGET}/cmd/* ${work}/cmd/ 2>/dev/null; cp ${TARGET}/go.mod ${work}/ 2>/dev/null; true`,
			]);
			rows.push(await runOne(arm, work, `${tag}-${i + 1}`));
		} catch (err) {
			console.log(
				JSON.stringify({ arm: arm.name, tag: `${tag}-${i + 1}`, error: String(err).slice(0, 300) }),
			);
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	}
}
console.log("DONE " + rows.length);
