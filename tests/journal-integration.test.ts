/**
 * Falsifier for the run journal: real child session, real runSubagent, real journal file.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { foldJournal } from "../src/telemetry/journal.ts";
import { loadSubagentFromContent } from "../src/infra/subagent-files.ts";
import { runSubagent } from "../src/app/run.ts";

const gate = process.env.PI_IT_JOURNAL === "1";

describe("journal integration (real session)", () => {
	it(
		"records run_start → turns/tools → run_end with cap note",
		{ skip: gate ? false : "set PI_IT_JOURNAL=1 to run (needs LLM proxy)" },
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "pi-journal-"));
			const journalPath = join(dir, "journal.ndjson");
			process.env.PI_SUBAGENTS_JOURNAL = journalPath;
			try {
				const md = [
					"---",
					"name: journaled",
					"description: probe",
					"model: opencode-zen-responses/deepseek-v4.1-flash-free",
					"thinkingLevel: off",
					"autonomy: high",
					"tools: read, bash, codemode",
					"budget: { maxTurns: 2, maxReportChars: 2000 }",
					"---",
					"",
					"probe",
				].join("\n");
				const cfg = loadSubagentFromContent(md, join(dir, "p.md"), "user");
				assert.ok(typeof cfg !== "string");
				const pi = await import("@earendil-works/pi-coding-agent");
				const runtime = await pi.ModelRuntime.create();
				const registry = new pi.ModelRegistry(runtime);
				const model = registry.find("opencode-zen-responses", "deepseek-v4.1-flash-free");
				if (!model) throw new Error("no model");
				const ctx = { ui: {}, model, thinkingLevel: "off", modelRegistry: registry } as never;
				const result = await runSubagent(
					cfg,
					"Strict rule: each codemode call may do exactly ONE thing. Write 6 parts; each part runs one codemode echo checkpoint. No batching.",
					dir,
					ctx,
					undefined,
					"journal-test-run",
				);
				const rows = foldJournal(readFileSync(journalPath, "utf8").split("\n"));
				const mine = rows.filter((r) => r.id === "journal-test-run");
				assert.equal(mine.length, 1, "exactly one run row");
				const run = mine[0];
				assert.ok(run, "run row present");
				assert.equal(run.status, "done");
				assert.ok(run.turns >= 1, `turns recorded (got ${run.turns})`);
				assert.ok(run.tool !== undefined, "at least one tool seen");
				assert.ok((run.reportChars ?? 0) > 0, "report size recorded");
				assert.equal(run.reportChars, result.text.length, "journal matches result text length");
				assert.ok(
					(run.notes ?? []).some((n) => n.includes("turn budget")),
					"cap note visible in the journal row",
				);
				process.stdout.write(
					`journal rows: turns=${run.turns} tool=${run.tool} reportChars=${run.reportChars} notes=${JSON.stringify(run.notes)}\n`,
				);
			} finally {
				delete process.env.PI_SUBAGENTS_JOURNAL;
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);
});
