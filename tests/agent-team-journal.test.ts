import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	beginAgentTeamSession,
	createTask,
	updateTask,
} from "../src/app/agent-team/board/index.ts";

const lead = { name: "lead", lead: true };
const worker = { name: "worker", lead: false };

let dir = "";
let previous: string | undefined;

function journal(): Record<string, unknown>[] {
	const text = readFileSync(join(dir, "journal.ndjson"), "utf8").trim();
	return text ? text.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) : [];
}

function raw(): string {
	return readFileSync(join(dir, "journal.ndjson"), "utf8");
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-team-journal-"));
	previous = process.env.PI_SUBAGENTS_JOURNAL;
	process.env.PI_SUBAGENTS_JOURNAL = join(dir, "journal.ndjson");
	beginAgentTeamSession("s-journal");
});

afterEach(() => {
	if (previous === undefined) delete process.env.PI_SUBAGENTS_JOURNAL;
	else process.env.PI_SUBAGENTS_JOURNAL = previous;
	rmSync(dir, { recursive: true, force: true });
});

describe("every board write leaves one line", () => {
	it("writes a create with the task id, revision, and actor", () => {
		const created = createTask({ subject: "private subject", description: "" }, "alice");
		assert.ok(created.ok);
		assert.deepEqual(journal(), [
			{
				event: "agent_team_task",
				action: "create",
				taskId: "task-1",
				revision: 1,
				actor: "alice",
				ok: true,
			},
		]);
		assert.doesNotMatch(raw(), /private subject/, "the subject never reaches the journal");
	});

	it("writes a refused compare-and-set with the reason", () => {
		const created = createTask({ subject: "prove it", description: "" });
		if (!created.ok) assert.fail(created.error);
		assert.ok(updateTask({ taskId: "task-1", expectedRevision: 1, action: "claim" }, worker).ok);
		const stale = updateTask(
			{ taskId: "task-1", expectedRevision: 1, action: "edit", subject: "new subject" },
			lead,
		);
		assert.equal(stale.ok, false);
		const lines = journal();
		assert.equal(lines.length, 3, "create, claim, refused edit");
		const refused = lines[2];
		assert.equal(refused?.event, "agent_team_task");
		assert.equal(refused?.action, "edit");
		assert.equal(refused?.taskId, "task-1");
		assert.equal(refused?.revision, 2, "the line carries the revision the board is on");
		assert.equal(refused?.actor, "lead");
		assert.equal(refused?.ok, false);
		assert.match(String(refused?.error), /changed \(revision 2, expected 1\)/);
		assert.doesNotMatch(raw(), /new subject|prove it/, "no subject text either");
	});

	it("keeps a completion result out of the journal", () => {
		createTask({ subject: "prove it", description: "" });
		assert.ok(updateTask({ taskId: "task-1", expectedRevision: 1, action: "claim" }, worker).ok);
		assert.ok(
			updateTask(
				{
					taskId: "task-1",
					expectedRevision: 2,
					action: "complete",
					result: "secret finding in src/parser.ts",
				},
				worker,
			).ok,
		);
		const done = journal().at(-1);
		assert.equal(done?.action, "complete");
		assert.equal(done?.revision, 3);
		assert.equal(done?.actor, "worker");
		assert.equal(done?.ok, true);
		assert.doesNotMatch(raw(), /secret finding/, "the result text never reaches the journal");
	});
});
