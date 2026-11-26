import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	agentTeamBoard,
	agentTeamSnapshot,
	agentTeamSummary,
	beginAgentTeamSession,
	enableAgentTeam,
} from "../src/app/agent-team/board/index.ts";
import { InMemoryLedger, attachPersistence, restoreInto } from "../src/app/session/index.ts";
import { TaskStore } from "../src/domain/task/index.ts";
import {
	encodeState,
	fileState,
	loadWorkspaceLedger,
	saveState,
	saveWorkspaceLedger,
	workspaceLedgerPath,
} from "../src/infra/state/index.ts";
import type { AgentTeamLedgerEntry } from "../src/domain/agent-team/index.ts";

let dir = "";
let statePath = "";

function entry(text: string): AgentTeamLedgerEntry {
	return { text, kind: "fact", taskId: "task-1", by: "alice", at: 1 };
}

function seedState(): void {
	const snapshot = agentTeamSnapshot();
	assert.ok(snapshot);
	saveState(
		statePath,
		encodeState({
			version: 1,
			savedAt: 1,
			tasks: [],
			ledger: {},
			agentTeam: { ...snapshot, ledger: [] },
		}),
	);
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-persist-ledger-"));
	statePath = join(dir, "s.json");
	beginAgentTeamSession("s-persist-ledger");
	enableAgentTeam();
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("workspace ledger persistence", () => {
	it("merges workspace facts when a session restores", () => {
		seedState();
		saveWorkspaceLedger(statePath, "/repo", [entry("durable fact")], 10);
		const rows = restoreInto(new TaskStore(), new InMemoryLedger(), statePath, fileState, "/repo");
		assert.equal(rows, 0);
		assert.deepEqual(
			agentTeamBoard().ledger.map((row) => row.text),
			["durable fact"],
		);
		assert.equal(agentTeamSummary().facts, 1);
	});

	it("merges facts even when no state file exists", () => {
		saveWorkspaceLedger(statePath, "/repo", [entry("only fact")], 10);
		restoreInto(new TaskStore(), new InMemoryLedger(), statePath, fileState, "/repo");
		assert.deepEqual(
			agentTeamBoard().ledger.map((row) => row.text),
			["only fact"],
		);
	});

	it("journals a corrupt ledger once", () => {
		seedState();
		writeFileSync(workspaceLedgerPath(statePath), "{bad");
		const journalPath = join(dir, "journal.ndjson");
		const previous = process.env.PI_SUBAGENTS_JOURNAL;
		process.env.PI_SUBAGENTS_JOURNAL = journalPath;
		try {
			restoreInto(new TaskStore(), new InMemoryLedger(), statePath, fileState, "/repo");
			restoreInto(new TaskStore(), new InMemoryLedger(), statePath, fileState, "/repo");
		} finally {
			if (previous === undefined) delete process.env.PI_SUBAGENTS_JOURNAL;
			else process.env.PI_SUBAGENTS_JOURNAL = previous;
		}
		const rows = readFileSync(journalPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { event: string; message?: string });
		assert.equal(
			rows.filter(
				(row) => row.event === "state_error" && /Workspace ledger/.test(row.message ?? ""),
			).length,
			1,
		);
	});

	it("writes the workspace ledger when persistence flushes", () => {
		agentTeamBoard().ledger.push(entry("saved fact"));
		const stop = attachPersistence(
			new TaskStore(),
			new InMemoryLedger(),
			fileState,
			statePath,
			undefined,
			"/repo",
		);
		stop();
		const loaded = loadWorkspaceLedger(statePath, "/repo");
		assert.equal(loaded.status, "ok");
		assert.deepEqual(
			loaded.entries.map((row) => row.text),
			["saved fact"],
		);
	});
});
