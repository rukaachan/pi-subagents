/**
 * pi-subagents: does a tool's `promptGuidelines` reach the model's system prompt?
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RULE =
	"DELEGATE-RULE: hand multi-file work to a subagent instead of reading every file yourself.";

const pi = await import("@earendil-works/pi-coding-agent");

async function runMode(mode: "on" | "only"): Promise<Record<string, unknown>> {
	const work = mkdtempSync(join(tmpdir(), `guideline-${mode}-`));
	try {
		const settings = pi.SettingsManager.create(work, pi.getAgentDir());
		let payload: unknown;
		const loader = new pi.DefaultResourceLoader({
			cwd: work,
			agentDir: pi.getAgentDir(),
			settingsManager: settings,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noContextFiles: true,
			extensionFactories: [
				pi.createCodemodeExtension({ mode }),
				(api: {
					registerTool(tool: unknown): void;
					on(event: string, handler: (event: { payload?: unknown }) => void): void;
				}) => {
					api.on("before_provider_request", (event) => {
						payload ??= event.payload;
					});
					api.registerTool(
						pi.defineTool({
							name: "probe_delegate",
							label: "Probe delegate",
							description: "Hand work to a fresh context window.",
							promptSnippet: "probe_delegate(prompt): hand work to a subagent.",
							promptGuidelines: [RULE],
							parameters: { type: "object", properties: {}, required: [] } as never,
							execute: async () => ({
								content: [{ type: "text" as const, text: "ok" }],
								details: {},
							}),
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

		const { session } = await pi.createAgentSession({
			cwd: work,
			model: model as never,
			tools: ["read", "codemode", "probe_delegate"],
			resourceLoader: loader,
			sessionManager: pi.SessionManager.inMemory(),
		});
		await session.prompt("Reply with the single word: ok");

		const replayed = session.state.systemPrompt;
		const p = payload as { tools?: Array<{ name?: string; description?: string }> };
		const codemodeTool = (p.tools ?? []).find((t) => t.name === "codemode");
		const codemodeDesc = codemodeTool?.description ?? "";
		const body = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
		const result = {
			mode,
			payloadShape: Object.getOwnPropertyNames(payload ?? {}).slice(0, 12),
			requestMentionsDelegate: body.includes("probe_delegate"),
			requestHasRule: body.includes(RULE),
			replayedChars: replayed.length,
			replayedHasRule: replayed.includes(RULE),
			replayedHasDelegateSnippet: replayed.includes("probe_delegate(prompt)"),
			replayedHasDelegateLine: replayed.includes("- probe_delegate:"),
			codemodeDescChars: codemodeDesc.length,
			codemodeDescTokens: Math.round(codemodeDesc.length / 4),
			codemodeDescHasRule: codemodeDesc.includes(RULE),
			systemChars: replayed.length,
		};
		session.dispose();
		return result;
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

for (const mode of ["on", "only"] as const) {
	console.log(JSON.stringify(await runMode(mode)));
}
