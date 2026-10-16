/**
 * pi-subagents: does a stop request reach a background chain step?
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SUB = `---
name: chain-stop-probe
description: Works slowly until someone stops it.
model: inherit
tools: read
codemode: false
autonomy: inherit
---

Read every file you are given, one by one, and never stop early.
`;

async function main(): Promise<void> {
	const pi = await import("@earendil-works/pi-coding-agent");
	const { loadSubagentFromContent } = await import("../src/infra/subagent-files.ts");
	const { runChainTask } = await import("../src/app/chain-task.ts");
	const { liveCount } = await import("../src/app/live-runs.ts");
	const { stopAllLiveRuns } = await import("../src/app/stop-all.ts");
	const { store } = await import("../src/app/live-store.ts");
	const { foldJournalFile } = await import("../src/telemetry/journal-fold.ts");
	const { defaultJournalPath } = await import("../src/telemetry/journal-path.ts");
	const { ledger } = await import("../src/app/ledger.ts");

	const home = mkdtempSync(join(tmpdir(), "chain-stop-probe-"));
	const work = mkdtempSync(join(tmpdir(), "chain-stop-work-"));
	try {
		const files: string[] = [];
		for (let i = 0; i < 30; i++) {
			const name = `f${i}.txt`;
			writeFileSync(join(work, name), `line ${i}\n`.repeat(400), "utf8");
			files.push(name);
		}
		const file = join(home, "chain-stop-probe.md");
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
		const ctx = { ui: {}, model, thinkingLevel: "off", modelRegistry, cwd: work } as never;

		const zero = { stopped: 0, done: 0, error: 0 };
		const before = { ...zero, ...ledger.bySubagent()[cfg.name] };
		const started = await runChainTask(
			store,
			[cfg.name],
			{
				description: "chain stop probe",
				prompt: `Read ${files.join(", ")}.`,
				run_in_background: true,
			},
			undefined,
			ctx,
			[cfg],
		);
		const details = started.details as { task_id?: string } | undefined;
		const taskId = details?.task_id ?? "";
		if (!taskId) throw new Error("the chain did not start");

		await new Promise<void>((resolve) => {
			setTimeout(resolve, 4000);
		});
		const liveBefore = liveCount();
		const startedAt = Date.now();
		const notice = stopAllLiveRuns("Esc");
		const stopMs = Date.now() - startedAt;
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 750);
		});

		const after = { ...zero, ...ledger.bySubagent()[cfg.name] };
		const ledgerDelta = {
			stopped: (after.stopped ?? 0) - before.stopped,
			done: (after.done ?? 0) - before.done,
			error: (after.error ?? 0) - before.error,
		};
		const runs = foldJournalFile(defaultJournalPath());
		const step = runs.find((r) => r.id === `${taskId}-0`);
		console.log(
			JSON.stringify(
				{
					taskId,
					rowStatus: store.get(taskId)?.status,
					rowError: store.get(taskId)?.error,
					liveBefore,
					notice,
					stopMs,
					liveAfterStop: liveCount(),
					rowGone: store.get(taskId) === undefined,
					ledgerDelta,
					stepJournal: step ? { status: step.status, turns: step.turns } : "(no step row)",
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
