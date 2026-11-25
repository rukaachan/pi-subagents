/**
 * pi-subagents: an isolated home for one e2e scenario.
 */

import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { projectStatePath } from "../../src/infra/state/index.ts";

const repoRoot = resolvePath(fileURLToPath(new URL("../..", import.meta.url)));
const fixtures = join(repoRoot, "tests", "fixtures", "e2e", "subagents");
const starters = join(repoRoot, "subagents");

export interface E2EHome {
	dir: string;
	agentDir: string;
	settingsPath: string;
	modelsPath: string;
	subagentsDir: string;
	journalPath: string;
	statePath: string;
	hookPath: string;
	env: NodeJS.ProcessEnv;
	cleanup: () => void;
}

export interface E2EHomeOptions {
	/** The fake provider's `/v1` base URL. */
	baseUrl: string;
	liveCap?: number;
	/** `fixtures` (default) copies the e2e legs; `starters` copies the shipped roster. */
	subagents?: "fixtures" | "starters";
	/** Defaults to appending JSON lines to `hookPath`. */
	finishHook?: string;
}

export function createE2EHome(opts: E2EHomeOptions): E2EHome {
	const dir = mkdtempSync(join(tmpdir(), "pi-e2e-"));
	const agentDir = join(dir, ".pi", "agent");
	const subagentsDir = join(agentDir, "subagents");
	const journalPath = join(dir, "journal.ndjson");
	const statePath = projectStatePath(agentDir, repoRoot);
	const hookPath = join(dir, "hook.ndjson");
	mkdirSync(subagentsDir, { recursive: true });

	const source = opts.subagents === "starters" ? starters : fixtures;
	for (const file of readdirSync(source)) {
		if (file.endsWith(".md")) copyFileSync(join(source, file), join(subagentsDir, file));
	}

	const settings = {
		$schema: "https://pi.dev/schemas/settings.schema.json",
		theme: "dark",
		quietStartup: true,
		defaultProvider: "e2e",
		defaultModel: "e2e",
		defaultThinkingLevel: "off",
		hideThinkingBlock: true,
		tuiMode: "fullscreen",
		codemode: { mode: "off" },
		retry: { enabled: false },
		"pi-subagents": {
			...(opts.liveCap !== undefined ? { liveCap: opts.liveCap } : {}),
			finishHook: opts.finishHook ?? `cat >> ${JSON.stringify(hookPath)}`,
		},
	};
	const settingsPath = join(agentDir, "settings.json");
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

	const models = {
		$schema: "https://pi.dev/schemas/models.schema.json",
		providers: {
			e2e: {
				baseUrl: opts.baseUrl,
				api: "openai-completions",
				apiKey: "e2e",
				models: [
					{
						id: "e2e",
						name: "E2E",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 32_000,
						maxTokens: 2048,
					},
				],
			},
		},
	};
	const modelsPath = join(agentDir, "models.json");
	writeFileSync(modelsPath, `${JSON.stringify(models, null, 2)}\n`);

	return {
		dir,
		agentDir,
		settingsPath,
		modelsPath,
		subagentsDir,
		journalPath,
		statePath,
		hookPath,
		env: {
			...process.env,
			HOME: dir,
			PI_SUBAGENTS_JOURNAL: journalPath,
			PI_SUBAGENTS_STATE: statePath,
		},
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}
