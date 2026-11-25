import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeState } from "../src/infra/state/index.ts";
import { foldJournalFile } from "../src/telemetry/journal/journal-fold.ts";
import {
	migrateFiles,
	migrateJournalText,
	migrateStateText,
	verifyTarget,
	writeIfUnchanged,
	type MigrationTarget,
} from "../tools/migrate-agent-team.mts";

const OLD_STATE = JSON.stringify({
	version: 1,
	savedAt: 7,
	tasks: [],
	ledger: {},
	team: {
		teamId: "t-1",
		enabled: true,
		nextId: 2,
		tasks: [],
		members: [],
		coldMail: { worker: ["[team message] from lead: hi"] },
	},
});

function temp(): string {
	return mkdtempSync(join(tmpdir(), "agent-team-migrate-"));
}

function stateFile(dir: string): string {
	const path = join(dir, "state.json");
	writeFileSync(path, OLD_STATE);
	return path;
}

describe("agent-team migration text", () => {
	it("renames the state key, id, and cold-mail prefix", () => {
		const result = migrateStateText(OLD_STATE);
		assert.equal(result.ok, true);
		if (!result.ok) return;
		const parsed = JSON.parse(result.text) as Record<string, any>;
		assert.equal(parsed.team, undefined);
		assert.equal(parsed.agentTeam.agentTeamId, "t-1");
		assert.equal(parsed.agentTeam.teamId, undefined);
		assert.deepEqual(parsed.agentTeam.coldMail.worker, ["[agent-team message] from lead: hi"]);
	});

	it("leaves an already migrated state byte for byte", () => {
		const once = migrateStateText(OLD_STATE);
		assert.equal(once.ok, true);
		if (!once.ok) return;
		const twice = migrateStateText(once.text);
		assert.equal(twice.ok, true);
		if (!twice.ok) return;
		assert.equal(twice.changed, false);
		assert.equal(twice.text, once.text);
	});

	it("rewrites only event names and keeps every other line byte for byte", () => {
		const raw = [
			'{"event":"run_start","id":"r1","label":"x","kind":"delegate"}',
			'{"event":"team_task","action":"create","taskId":"task-1","revision":1,"actor":"lead","ok":true}',
			'{"event": "team_message", "from":"lead","to":"worker","chars":2}',
			'{"event":"run_end","id":"r1","outcome":"done"}',
			"",
		].join("\n");
		const result = migrateJournalText(raw);
		assert.equal(result.ok, true);
		if (!result.ok) return;
		const lines = result.text.split("\n");
		assert.equal(lines[0], raw.split("\n")[0]);
		assert.match(lines[1] ?? "", /"event":"agent_team_task"/);
		assert.match(lines[2] ?? "", /"event": "agent_team_message"/);
		assert.equal(lines[3], raw.split("\n")[3]);
		assert.equal(result.text.endsWith("\n"), true);
	});

	it("reports invalid JSON instead of guessing", () => {
		const result = migrateJournalText('{"event":"team_task"}\nnot json\n');
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.match(result.reason, /line 2/);
	});
});

describe("agent-team migration files", () => {
	it("dry-run reports changes without writing or backing up", () => {
		const dir = temp();
		try {
			const path = stateFile(dir);
			const report = migrateFiles([{ path, kind: "state" }], { write: false });
			assert.deepEqual(report.changed, [path]);
			assert.equal(readFileSync(path, "utf8"), OLD_STATE);
			assert.equal(existsSync(`${path}.pre-agent-team.bak`), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("write keeps a backup, rewrites atomically, and is idempotent", () => {
		const dir = temp();
		try {
			const path = stateFile(dir);
			const target: MigrationTarget = { path, kind: "state" };
			const first = migrateFiles([target], { write: true });
			assert.deepEqual(first.changed, [path]);
			assert.equal(readFileSync(`${path}.pre-agent-team.bak`, "utf8"), OLD_STATE);
			assert.equal(verifyTarget(target), 0);
			const second = migrateFiles([target], { write: true });
			assert.deepEqual(second.changed, []);
			assert.equal(readFileSync(`${path}.pre-agent-team.bak`, "utf8"), OLD_STATE);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips invalid files and reports why", () => {
		const dir = temp();
		try {
			const path = join(dir, "broken.json");
			writeFileSync(path, "{nope");
			const report = migrateFiles([{ path, kind: "state" }], { write: true });
			assert.deepEqual(report.changed, []);
			assert.equal(report.skipped[0]?.reason, "invalid JSON");
			assert.equal(readFileSync(path, "utf8"), "{nope");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses to overwrite a file changed between read and write", () => {
		const dir = temp();
		try {
			const path = stateFile(dir);
			const stamp = { mtimeMs: statSync(path).mtimeMs, size: statSync(path).size };
			writeFileSync(path, "newer");
			assert.equal(writeIfUnchanged(path, "migrated", stamp), false);
			assert.equal(readFileSync(path, "utf8"), "newer");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("legacy reads", () => {
	it("decodes an old team key into agentTeam", () => {
		const state = decodeState(OLD_STATE);
		assert.equal(state?.agentTeam?.agentTeamId, "t-1");
	});

	it("folds an old team event without losing the run", () => {
		const dir = temp();
		try {
			const path = join(dir, "journal.ndjson");
			writeFileSync(
				path,
				[
					'{"event":"run_start","id":"r1","label":"leg","kind":"delegate"}',
					'{"event":"team_task","action":"create","taskId":"task-1","revision":1,"actor":"lead","ok":true}',
					'{"event":"run_end","id":"r1","outcome":"done"}',
					"",
				].join("\n"),
			);
			const runs = foldJournalFile(path);
			assert.equal(runs.length, 1);
			assert.equal(runs[0]?.id, "r1");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
