/**
 * pi-subagents: A/B: does codemode cut turns and wall time for a write-grade task?
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const TARGET = "/home/taufik/Documents/Tech/opencode-relay";

const SUB = `---
name: ab-worker
description: A/B probe worker.
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

const BATCHED_BODY = `Method:
- Batch independent reads and searches into ONE codemode script with Promise.allSettled. Keep edits and writes as their own calls.
- Read the code before you change it. Know the call sites you will break.
- Change the smallest thing that makes the task work.

Script rules:
- tools.bash resolves even when the command fails (failed exit lands in value.exit_code). Guard it: r.status === "fulfilled" && r.value.exit_code === 0 before reading r.value.output.
- Write literal calls inside Promise.allSettled. Keep 2-6 execs per script.
- If a result says "Script failed": the return value never ran. Read the error text, fix the code, retry once.`;

const TAIL = ` and codemode`;
const TAIL_BARE = ``;

const TASKS: Record<string, string> = {
	inventory: `Task: build an inventory of every place in internal/ (all packages) that mentions \`terse400\` or \`replayTerse4xx\`.

For EACH mention, report one line: path:line, the enclosing function, and what that line does (3-12 words).

Do not change any file. Then verify the tree still builds with: go build ./...`,
	perfile: `Task: open EACH Go file in internal/zen/ one by one (every .go file, tests included) and report, for each: its filename, its package line, and its total line count. Read each file's contents — do not infer from names.

Do not change any file. Then verify the tree still builds with: go build ./...`,
};

const PROMPT = `Work in the repo at the current directory (Go, module opencode-relay).\n\n${TASKS[process.env.AB_TASK ?? "inventory"] ?? TASKS.inventory}\n\nReport what the task asks for, then the build output.`;

interface Arm {
	name: string;
	file: string;
}

function writeFixture(dir: string, arm: Arm, bare: boolean): string {
	const path = join(dir, `${arm.name}.md`);
	const content = SUB.replace("{{CODEMODE}}", bare ? "" : "codemode: true\n")
		.replace("{{TAIL}}", bare ? TAIL_BARE : TAIL)
		.replace("{{BODY}}", bare ? BARE_BODY : BATCHED_BODY);
	execFileSync("mkdir", ["-p", dir]);
	execFileSync("bash", ["-c", `cat > ${path} <<'FIXTURE_EOF'\n${content}\nFIXTURE_EOF`]);
	return path;
}

async function runOne(
	armName: string,
	bare: boolean,
	cwd: string,
	tag: string,
): Promise<Record<string, unknown>> {
	const pi = await import("@earendil-works/pi-coding-agent");
	const { loadSubagentFromContent } = await import("../src/domain/subagent/frontmatter.ts");
	const { startSubagentSession } = await import("../src/infra/host-session.ts");
	const { sumUsage } = await import("../src/domain/run-result.ts");

	const agentsDir = join(cwd, ".ab-agents");
	writeFixture(agentsDir, { name: "ab-worker", file: "" }, bare);
	const file = join(agentsDir, "ab-worker.md");
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
		await child.session.prompt(PROMPT);
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
		const elapsedSec = Math.round((Date.now() - start) / 1000);
		const text = child.session.getLastAssistantText() ?? "";
		const row = {
			arm: armName,
			tag,
			elapsedSec,
			turns,
			toolCalls: tools.length,
			toolsPerTurn: turns ? +(tools.length / turns).toFixed(2) : 0,
			codemodeCalls: tools.filter((t) => t === "codemode").length,
			input,
			output,
			usd: +((input / 1e6) * 3 + (output / 1e6) * 15).toFixed(4),
			reportChars: text.length,
			verified: /ok\s+opencode-relay|PASS|ok\s+"/.test(text),
		};
		console.log(JSON.stringify(row));
		return row;
	} finally {
		child.session.dispose();
	}
}

const argv = process.argv.slice(2);
const legs = Number(argv[argv.indexOf("--legs") + 1] || 1);
const only = argv.includes("--arm") ? argv[argv.indexOf("--arm") + 1] : "both";
const tag = argv.includes("--tag")
	? argv[argv.indexOf("--tag") + 1]
	: new Date().toISOString().slice(11, 19);

const rows: Record<string, unknown>[] = [];
for (let i = 0; i < legs; i++) {
	for (const [name, bare] of [
		["bare", true],
		["batched", false],
	] as [string, boolean][]) {
		if (only !== "both" && only !== name) continue;
		const work = mkdtempSync(join(tmpdir(), `ab-${name}-`));
		try {
			execFileSync("bash", [
				"-c",
				`cp -r ${TARGET}/internal ${work}/ && mkdir -p ${work}/cmd && cp -r ${TARGET}/cmd/* ${work}/cmd/ 2>/dev/null; cp ${TARGET}/go.mod ${work}/ 2>/dev/null; true`,
			]);
			rows.push(await runOne(name, bare, work, `${tag}-${i + 1}`));
		} catch (err) {
			console.log(
				JSON.stringify({ arm: name, tag: `${tag}-${i + 1}`, error: String(err).slice(0, 200) }),
			);
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	}
}
console.log("DONE " + rows.length);
