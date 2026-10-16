/**
 * pi-subagents: does a stop request really kill a live run?
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SUB = `---
name: stop-probe
description: Works slowly until someone stops it.
model: inherit
tools: read, bash
codemode: false
autonomy: inherit
---

Read every file you are given, one by one, and never stop early.
`;

async function main(): Promise<void> {
	const pi = await import("@earendil-works/pi-coding-agent");
	const { loadSubagentFromContent } = await import("../src/infra/subagent-files.ts");
	const { launchBackground } = await import("../src/app/background.ts");
	const { liveCount, liveLabels } = await import("../src/app/live-runs.ts");
	const { stopAllLiveRuns } = await import("../src/app/stop-all.ts");
	const { store } = await import("../src/app/live-store.ts");
	const { removedIds, unknownTaskMessage } = await import("../src/app/removed-ids.ts");
	const { ledger } = await import("../src/app/ledger.ts");
	const { foldJournalFile } = await import("../src/telemetry/journal-fold.ts");
	const { defaultJournalPath } = await import("../src/telemetry/journal-path.ts");

	const home = mkdtempSync(join(tmpdir(), "stop-probe-"));
	const work = mkdtempSync(join(tmpdir(), "stop-work-"));
	try {
		const files: string[] = [];
		for (let i = 0; i < 30; i++) {
			const name = `f${i}.txt`;
			writeFileSync(join(work, name), `line ${i}\n`.repeat(400), "utf8");
			files.push(name);
		}
		const file = join(home, "stop-probe.md");
		writeFileSync(file, SUB, "utf8");
		const cfg = loadSubagentFromContent(readFileSync(file, "utf8"), file, "user");
		if (typeof cfg === "string") throw new Error(`fixture did not parse: ${cfg}`);

		const runtime = await (
			pi as unknown as { ModelRuntime: { create(): Promise<unknown> } }
		).ModelRuntime.create();
		const modelRegistry = new (
			pi as unknown as { ModelRegistry: new (r: unknown) => ModelRegistry }
		).ModelRegistry(runtime);
		const model = modelRegistry.find("opencode-zen-responses", "deepseek-v4.1-flash-free");
		if (!model) throw new Error("no probe model resolved");
		const ctx = { ui: {}, model, thinkingLevel: "off", modelRegistry } as never;

		const before = { ...(ledger.bySubagent()[cfg.name] ?? { stopped: 0, done: 0, error: 0 }) };
		const taskId = await launchBackground(
			store,
			cfg,
			"stop probe",
			`Read ${files.join(", ")}.`,
			work,
			ctx,
		);
		const liveAtLaunch = { count: liveCount(), labels: liveLabels() };

		await new Promise<void>((resolve) => {
			setTimeout(resolve, 4000);
		});
		const startedAt = Date.now();
		const notice = stopAllLiveRuns("Esc");
		const stopMs = Date.now() - startedAt;

		await new Promise<void>((resolve) => {
			setTimeout(resolve, 750);
		});
		const runs = foldJournalFile(defaultJournalPath());
		const run = runs.find((r) => r.id === taskId);
		const row = store.get(taskId);
		const after = ledger.bySubagent()[cfg.name] ?? { stopped: 0, done: 0, error: 0 };
		const delta = {
			stopped: (after.stopped ?? 0) - (before.stopped ?? 0),
			done: (after.done ?? 0) - (before.done ?? 0),
			error: (after.error ?? 0) - (before.error ?? 0),
		};

		console.log(
			JSON.stringify(
				{
					taskId,
					liveAtLaunch,
					notice,
					stopMs,
					liveAfterStop: liveCount(),
					rowGone: row === undefined,
					removedKnown: removedIds.has(taskId),
					pollAnswer: unknownTaskMessage(taskId),
					ledgerDelta: delta,
					journal: run
						? { status: run.status, turns: run.turns, elapsedSec: run.elapsedSec }
						: "(no journal row)",
				},
				null,
				1,
			),
		);
		stopAllLiveRuns("quit");
	} finally {
		rmSync(home, { recursive: true, force: true });
		rmSync(work, { recursive: true, force: true });
	}
}

await main();
