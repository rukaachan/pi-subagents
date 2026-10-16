/**
 * pi-subagents: does a subagent session compact on its own?
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SUB = `---
name: compaction-probe
description: Reads many files to fill a context window.
model: inherit
tools: read
codemode: false
autonomy: inherit
---

You read files one by one and report how many you read.
`;

const FILE_COUNT = 40;

async function main(): Promise<void> {
	const pi = await import("@earendil-works/pi-coding-agent");
	const { loadSubagentFromContent } = await import("../src/infra/subagent-files.ts");
	const { startSubagentSession } = await import("../src/infra/host-session.ts");
	const { trackSession } = await import("../src/telemetry/track.ts");
	const { footerProgress } = await import("../src/telemetry/progress.ts");

	const home = mkdtempSync(join(tmpdir(), "compaction-probe-"));
	const work = mkdtempSync(join(tmpdir(), "compaction-work-"));
	try {
		const files: string[] = [];
		for (let i = 0; i < FILE_COUNT; i++) {
			const name = `f${i}.txt`;
			writeFileSync(join(work, name), `line ${i} with some words to count\n`.repeat(400), "utf8");
			files.push(name);
		}
		const file = join(home, "compaction-probe.md");
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
		const found = modelRegistry.find(
			"opencode-zen-responses",
			"deepseek-v4.1-flash-free",
		) as unknown as { contextWindow: number };
		if (!found) throw new Error("no probe model resolved");

		// A small window puts the threshold inside a few reads. The
		// compaction rule is the host's; only the size of the window
		// is ours.
		const model = { ...found, contextWindow: 30000 } as never;
		const ctx = { ui: {}, model, thinkingLevel: "off", modelRegistry } as never;

		const child = await startSubagentSession(cfg, work, ctx);
		const events: string[] = [];
		let compactions = 0;
		const stop = trackSession(child.session, "probe", "compaction-probe");
		child.session.subscribe((e: { type: string; reason?: string }) => {
			if (e.type === "compaction_start") {
				compactions += 1;
				events.push(`compaction_start:${e.reason ?? "?"}`);
			} else if (e.type === "compaction_end") {
				events.push(`compaction_end:${e.reason ?? "?"}`);
			}
		});
		await child.session.prompt(
			`Read every one of these files, one by one, with the read tool: ${files.join(", ")}. Then report the count.`,
		);
		const messages = child.session.messages ?? [];
		let input = 0;
		for (const m of messages) {
			if (m.role === "assistant") input += m.usage?.input ?? 0;
		}
		console.log(
			JSON.stringify({
				sessionWindow: (child.session.model as unknown as { contextWindow: number }).contextWindow,
				modelWindow: 30000,
				reserveTokens: 16384,
				thresholdTokens: 30000 - 16384,
				compactions,
				events,
				messages: messages.length,
				lastInputTokens: input,
				footerNote: footerProgress.snapshot("probe")?.partial ?? "",
			}),
		);
		stop({ status: "done", reportChars: 0 });
		child.session.dispose();
	} finally {
		rmSync(home, { recursive: true, force: true });
		rmSync(work, { recursive: true, force: true });
	}
}

await main();
