/**
 * pi-subagents: does the shipped delegation rule change what the model does?
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { DELEGATION_RULE, taskMeta } from "../src/tools/task/meta.ts";

const pi = await import("@earendil-works/pi-coding-agent");

const LONG = process.argv.includes("--long");

const EXTRA_TOOLS = [
	["web_search", "Search the web and return ranked results with snippets."],
	["mcp__docs__search", "Search the documentation server for a library and return pages."],
	["memory_save", "Save a note under a key so a later session can read it."],
	["todo_write", "Replace the session todo list with the given items."],
	["browser_navigate", "Open a URL in a headless browser and return the page text."],
	["pdf_read", "Read a PDF file and return its text, page by page."],
	["db_query", "Run a read-only SQL query against the project database."],
	["image_gen", "Generate an image from a text prompt and return its path."],
] as const;

function seedHistory(manager: ReturnType<typeof pi.SessionManager.inMemory>): void {
	for (let i = 0; i < 24; i++) {
		manager.appendMessage({
			role: "user",
			content: `Turn ${i}: review src/module${i}.ts, note the collision between the cache key and the config key, and keep the diff small.`,
			timestamp: Date.now(),
		});
		manager.appendMessage({
			role: "assistant",
			content: [
				{
					type: "text",
					text: `Read src/module${i}.ts and src/config/read.ts. The cache key reused the config key, so a config reload dropped a warm entry. Renamed the local to cacheKey${i}, kept the public shape, and noted the follow-up in the report.`,
				},
			],
			api: "openai-responses",
			provider: "opencode-zen-responses",
			model: "deepseek-v4.1-flash-free",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			stopReason: "stop",
			timestamp: Date.now(),
		} as never);
	}
}

const HEAVY = [
	"Find every place the config file is read in this repo, then say which module owns the parsing.",
	"Rename the field `userId` to `accountId` everywhere it appears and keep the code consistent.",
	"The test suite is failing. Work out why across whatever files you need to read.",
	"Review every file under src/ for a missing null check and report the risky ones.",
];
const LIGHT = [
	"What version is this package? Read package.json only.",
	"Add a trailing newline to README.md if it is missing.",
];

function fakeRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "delegation-probe-"));
	mkdirSync(join(dir, "src", "auth"), { recursive: true });
	mkdirSync(join(dir, "src", "config"), { recursive: true });
	mkdirSync(join(dir, "test"), { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name: "probe-repo", version: "0.4.2", type: "module" }, null, 2),
	);
	writeFileSync(join(dir, "README.md"), "# probe repo\n");
	writeFileSync(
		join(dir, "src", "auth", "session.ts"),
		"export interface Session { userId: string; token: string }\n",
	);
	writeFileSync(
		join(dir, "src", "auth", "login.ts"),
		'import { readConfig } from "../config/read.ts";\nexport const login = (userId: string) => readConfig(userId);\n',
	);
	writeFileSync(
		join(dir, "src", "config", "read.ts"),
		'export const readConfig = (userId: string) => ({ userId, theme: "dark" });\n',
	);
	writeFileSync(
		join(dir, "src", "config", "write.ts"),
		"export const writeConfig = (userId: string, theme: string) => ({ userId, theme });\n",
	);
	writeFileSync(
		join(dir, "test", "login.test.ts"),
		'import { login } from "../src/auth/login.ts";\nconsole.log(login("u1"));\n',
	);
	return dir;
}

interface Arm {
	mode: "on" | "only";
	rule: boolean;
}

async function runOne(arm: Arm, prompt: string): Promise<{ delegated: boolean; chars: number }> {
	const work = fakeRepo();
	try {
		const settings = pi.SettingsManager.create(work, pi.getAgentDir());
		let delegated = false;
		let promptChars = 0;
		const loader = new pi.DefaultResourceLoader({
			cwd: work,
			agentDir: pi.getAgentDir(),
			settingsManager: settings,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noContextFiles: true,
			extensionFactories: [
				pi.createCodemodeExtension({ mode: arm.mode }),
				(api: { registerTool(tool: unknown): void }) => {
					for (const [name, description] of LONG ? EXTRA_TOOLS : []) {
						api.registerTool(
							pi.defineTool({
								name,
								label: name,
								description,
								parameters: { type: "object", properties: {}, required: [] } as never,
								execute: async () => ({
									content: [{ type: "text" as const, text: "ok" }],
									details: {},
								}),
							}),
						);
					}
					api.registerTool(
						pi.defineTool({
							...taskMeta,
							promptGuidelines: arm.rule ? [DELEGATION_RULE] : [],
							parameters: Type.Object({
								subagent_type: Type.Optional(Type.String()),
								description: Type.Optional(Type.String()),
								prompt: Type.Optional(Type.String()),
							}),
							execute: async () => {
								delegated = true;
								return {
									content: [{ type: "text" as const, text: "delegated (probe stub)" }],
									details: { probe: true },
								};
							},
						}),
					);
				},
			] as never,
		});
		await loader.reload();

		const model = new pi.ModelRegistry(
			(await (
				pi as unknown as { ModelRuntime: { create(): Promise<unknown> } }
			).ModelRuntime.create()) as never,
		).find("opencode-zen-responses", "deepseek-v4.1-flash-free");
		if (!model) throw new Error("probe model not found");

		const manager = pi.SessionManager.inMemory(work);
		if (LONG) seedHistory(manager);
		const extra = LONG ? EXTRA_TOOLS.map(([name]) => name) : [];
		const { session } = await pi.createAgentSession({
			cwd: work,
			model: model as never,
			tools: [...(arm.mode === "only" ? ["codemode", "Task"] : ["read", "Task"]), ...extra],
			resourceLoader: loader,
			sessionManager: manager,
		});
		session.subscribe((event: { type: string; toolName?: string }) => {
			if (event.type === "tool_execution_start" && event.toolName === "Task") delegated = true;
		});
		// One runaway answer must not stall the whole matrix.
		const timer = setTimeout(() => {
			void session.abort();
		}, 45_000);
		try {
			await session.prompt(prompt);
		} catch {
		} finally {
			clearTimeout(timer);
		}
		promptChars = session.state.systemPrompt.length;
		session.dispose();
		return { delegated, chars: promptChars };
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

function armFromArgs(): Arm[] {
	const mode = process.argv.find((a) => a.startsWith("--mode="))?.slice("--mode=".length);
	const rule = process.argv.find((a) => a.startsWith("--rule="))?.slice("--rule=".length);
	if (mode !== "on" && mode !== "only") {
		return [
			{ mode: "on", rule: false },
			{ mode: "on", rule: true },
			{ mode: "only", rule: false },
			{ mode: "only", rule: true },
		];
	}
	return [{ mode, rule: rule === "true" }];
}

const arms: Arm[] = armFromArgs();
const VAGUE = [
	"Cek apa yang terjadi dengan autentikasi di repo ini.",
	"Rapikan penanganan konfigurasi, terlalu banyak tempat membaca file yang sama.",
	"Lihat-lihat isi repo ini dan kasih tahu apa yang perlu diperbaiki dulu.",
	"Kenapa ada duplikasi di src/? Cari dan jelaskan.",
];
const SET = process.argv.find((a) => a.startsWith("--set="))?.slice("--set=".length);
const prompts = [
	...(SET === "vague" ? VAGUE : HEAVY).map((p) => ({ p, cls: "heavy" })),
	...LIGHT.map((p) => ({ p, cls: "light" })),
];

for (const arm of arms) {
	const rows: Array<{ cls: string; delegated: boolean; chars: number }> = [];
	for (const { p, cls } of prompts) {
		const r = await runOne(arm, p);
		rows.push({ cls, ...r });
		console.log(
			JSON.stringify({
				mode: arm.mode,
				rule: arm.rule,
				cls,
				delegated: r.delegated,
				chars: r.chars,
			}),
		);
	}
	const heavy = rows.filter((r) => r.cls === "heavy");
	const light = rows.filter((r) => r.cls === "light");
	console.log(
		JSON.stringify({
			summary: true,
			long: LONG,
			mode: arm.mode,
			rule: arm.rule,
			heavyDelegated: `${heavy.filter((r) => r.delegated).length}/${heavy.length}`,
			lightDelegated: `${light.filter((r) => r.delegated).length}/${light.length}`,
			systemPromptChars: rows[0]?.chars ?? 0,
		}),
	);
}
