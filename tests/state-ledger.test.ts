import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadWorkspaceLedger,
	saveWorkspaceLedger,
	workspaceKey,
	workspaceLedgerPath,
} from "../src/infra/state/index.ts";
import {
	mergeAgentTeamLedger,
	newAgentTeam,
	type AgentTeamLedgerEntry,
} from "../src/domain/agent-team/index.ts";

let dir = "";
let statePath = "";

function entry(text: string, kind: AgentTeamLedgerEntry["kind"] = "fact"): AgentTeamLedgerEntry {
	return { text, kind, taskId: "task-1", by: "alice", at: 1 };
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-ledger-"));
	statePath = join(dir, "s.json");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("workspace ledger", () => {
	it("round-trips facts in a private atomic file", () => {
		const saved = saveWorkspaceLedger(statePath, "/repo", [entry("one")], 10);
		assert.deepEqual(saved, {});
		assert.equal(statSync(workspaceLedgerPath(statePath)).mode & 0o777, 0o600);
		const loaded = loadWorkspaceLedger(statePath, "/repo");
		assert.equal(loaded.status, "ok");
		assert.deepEqual(
			loaded.entries.map((row) => row.text),
			["one"],
		);
		assert.equal(workspaceKey("/repo").length, 12);
	});

	it("ignores foreign rows and keeps the newest twenty workspaces", () => {
		for (let i = 0; i < 21; i += 1) {
			saveWorkspaceLedger(statePath, `/repo-${i}`, [entry(`fact ${i}`)], i + 1);
		}
		const raw = JSON.parse(readFileSync(workspaceLedgerPath(statePath), "utf8")) as {
			workspaces: Record<string, unknown>;
		};
		assert.equal(Object.keys(raw.workspaces).length, 20);
		assert.equal(raw.workspaces[workspaceKey("/repo-0")], undefined);
		assert.ok(raw.workspaces[workspaceKey("/repo-20")]);
		writeFileSync(
			workspaceLedgerPath(statePath),
			JSON.stringify({
				version: 1,
				workspaces: {
					...raw.workspaces,
					bad: { updatedAt: 99, entries: [entry("bad")] },
				},
			}),
		);
		assert.deepEqual(loadWorkspaceLedger(statePath, "/repo-20").entries[0]?.text, "fact 20");
		saveWorkspaceLedger(statePath, "/repo-20", [entry("fact 20")], 100);
		const after = JSON.parse(readFileSync(workspaceLedgerPath(statePath), "utf8")) as {
			workspaces: Record<string, unknown>;
		};
		assert.equal(after.workspaces.bad, undefined);
	});

	it("keeps a workspace when a later save has no rows", () => {
		saveWorkspaceLedger(statePath, "/repo", [entry("keep")], 10);
		saveWorkspaceLedger(statePath, "/repo", [], 20);
		assert.deepEqual(
			loadWorkspaceLedger(statePath, "/repo").entries.map((row) => row.text),
			["keep"],
		);
	});

	it("reports a corrupt file and recovers on save", () => {
		writeFileSync(workspaceLedgerPath(statePath), "{not json");
		assert.equal(loadWorkspaceLedger(statePath, "/repo").status, "corrupt");
		saveWorkspaceLedger(statePath, "/repo", [entry("fresh")], 20);
		const loaded = loadWorkspaceLedger(statePath, "/repo");
		assert.equal(loaded.status, "ok");
		assert.equal(loaded.entries[0]?.text, "fresh");
	});

	it("reports a missing file without throwing", () => {
		assert.deepEqual(loadWorkspaceLedger(statePath, "/repo"), {
			entries: [],
			status: "missing",
		});
	});

	it("merges without duplicates and caps both kinds", () => {
		const board = newAgentTeam("s-ledger");
		const facts = Array.from({ length: 60 }, (_, i) => entry(`fact ${i}`));
		const excluded = Array.from({ length: 25 }, (_, i) => entry(`dead ${i}`, "excluded"));
		mergeAgentTeamLedger(board, [...facts, ...excluded, entry("fact 59")]);
		assert.equal(board.ledger.filter((row) => row.kind === "fact").length, 50);
		assert.equal(board.ledger.filter((row) => row.kind === "excluded").length, 20);
		assert.equal(board.ledger.filter((row) => row.text === "fact 59").length, 1);
	});
});
