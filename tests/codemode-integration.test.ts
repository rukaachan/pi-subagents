/**
 * Integration falsifier: real child session (pi 1.3.0 graph), real QuickJS codemode sandbox, one scripted call reading TWO files.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runOnce() {
	const pi = await import("@earendil-works/pi-coding-agent");
	const { loadSubagentFromContent } = await import("../src/infra/subagent-files.ts");
	const { startSubagentSession } = await import("../src/infra/host-session.ts");
	const { snapshotHistory } = await import("../src/domain/run-result.ts");

	const dir = mkdtempSync(join(tmpdir(), "pi-cm-it-"));
	const agentsDir = join(dir, "agents");
	mkdirSync(agentsDir, { recursive: true });
	writeFileSync(join(dir, "fileA.txt"), "alpha-family");
	writeFileSync(join(dir, "fileB.txt"), "beta-family");
	const md = [
		"---",
		"name: swimmer",
		"description: integration probe",
		"model: opencode-zen-responses/glm-5.3-flash-free",
		"thinkingLevel: off",
		"autonomy: high",
		"codemode: true",
		"---",
		"",
		"You are a scripting agent. SINGLE TURN, NO PROSE.",
		"Call the codemode tool ONCE with a script that does:",
		"  const [a, b] = await Promise.allSettled([await ctx.tools.read({ path: 'fileA.txt' }), await ctx.tools.read({ path: 'fileB.txt' })]);",
		"then returns JSON {a_len, b_len} with each file's content length.",
	].join("\n");
	writeFileSync(join(agentsDir, "swimmer.md"), md);
	const content = readFileSync(join(agentsDir, "swimmer.md"), "utf8");
	const cfg = loadSubagentFromContent(content, join(agentsDir, "swimmer.md"), "user");
	assert.ok(typeof cfg !== "string", "temp subagent parses");

	type AnyRegistry = { find(provider: string, id: string): unknown };
	const runtime = await (
		pi as unknown as { ModelRuntime: { create(): Promise<unknown> } }
	).ModelRuntime.create();
	const modelRegistry = new (
		pi as unknown as {
			ModelRegistry: new (r: unknown) => AnyRegistry;
		}
	).ModelRegistry(runtime);
	const model = modelRegistry.find("opencode-zen-responses", "glm-5.3-flash-free") as never;
	const ctx = { ui: {}, model, thinkingLevel: "off", modelRegistry } as never;

	let transcript = "";
	try {
		const child = await startSubagentSession(cfg, dir, ctx);
		await child.session.prompt("Do it now.");
		transcript = JSON.stringify(snapshotHistory(child.session));
		child.session.dispose();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	return transcript;
}

describe("codemode integration (real session)", () => {
	it(
		"one codemode call reads both fixture files in a single turn",
		{
			skip: process.env.PI_IT_CODEMODE ? false : "set PI_IT_CODEMODE=1 to run (needs LLM proxy)",
			timeout: 180_000,
		},
		async () => {
			const t = await runOnce();
			assert.match(t, /"name":"codemode"/, "codemode toolCall reached the session");
			assert.match(t, /allSettled/, "script batched both reads");
			assert.ok(t.includes("a_len"), "a_len in transcript");
			assert.ok(t.includes("b_len"), "b_len in transcript");
			assert.match(t, /a_len[^\d]*12/, "fileA read landed (len 12)");
			assert.match(t, /b_len[^\d]*11/, "fileB read landed (len 11)");
		},
	);
});
