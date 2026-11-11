import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverSubagents } from "../src/infra/subagent-files.ts";
import { findJournalRun, foldJournalFile } from "../src/telemetry/journal-fold.ts";

function scratch(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-subagents-cache-"));
	return dir;
}

function line(event: Record<string, unknown>): string {
	return JSON.stringify(event) + "\n";
}

function subagentFile(name: string, description: string): string {
	return `---\nname: ${name}\ndescription: ${description}\n---\nYou are a test.\n`;
}

test("findJournalRun follows an appended event", () => {
	const dir = scratch();
	const path = join(dir, "journal.ndjson");
	try {
		writeFileSync(
			path,
			line({ event: "run_start", id: "run-a", label: "worker", kind: "foreground", ts: 1 }),
		);
		assert.equal(findJournalRun("run-a", path)?.turns, 0);
		appendFileSync(path, line({ event: "turn", id: "run-a", turns: 3, ts: 2 }));
		assert.equal(findJournalRun("run-a", path)?.turns, 3);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("foldJournalFile re-folds after the file is rewritten", () => {
	const dir = scratch();
	const path = join(dir, "journal.ndjson");
	try {
		writeFileSync(
			path,
			line({ event: "run_start", id: "run-b", label: "worker", kind: "foreground", ts: 1 }) +
				line({ event: "run_end", id: "run-b", status: "done", turns: 1, elapsedSec: 2, ts: 2 }),
		);
		assert.equal(foldJournalFile(path)[0]?.status, "done");
		writeFileSync(
			path,
			line({ event: "run_start", id: "run-c", label: "tester", kind: "foreground", ts: 3 }) +
				line({ event: "run_end", id: "run-c", status: "error", turns: 2, elapsedSec: 4, ts: 4 }),
		);
		const runs = foldJournalFile(path);
		assert.deepEqual(
			runs.map((run) => [run.id, run.status]),
			[["run-c", "error"]],
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("discoverSubagents sees an added, then an edited, user subagent", () => {
	const dir = scratch();
	const agentDir = join(dir, "agent");
	const cwd = join(dir, "repo");
	const subDir = join(agentDir, "subagents");
	mkdirSync(subDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		assert.deepEqual(discoverSubagents(cwd).subagents, []);
		writeFileSync(join(subDir, "alpha.md"), subagentFile("alpha", "First."));
		assert.deepEqual(
			discoverSubagents(cwd).subagents.map((sub) => sub.description),
			["First."],
		);
		writeFileSync(join(subDir, "alpha.md"), subagentFile("alpha", "Second."));
		assert.deepEqual(
			discoverSubagents(cwd).subagents.map((sub) => sub.description),
			["Second."],
		);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});
