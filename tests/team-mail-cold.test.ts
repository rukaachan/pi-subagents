import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubagentConfig } from "../src/domain/subagent/index.ts";
import type { TaskRecord } from "../src/domain/task/index.ts";
import { newRecord } from "../src/domain/task/index.ts";
import { TaskStore } from "../src/domain/task/index.ts";
import { beginTeamSession, enableTeam, joinTeam } from "../src/app/team-store.ts";
import {
	bindTeamMail,
	bindTeamMember,
	clearTeamMail,
	MAX_COLD_MESSAGES,
	sendTeamMessage,
	teamMessageApi,
	waitForMember,
} from "../src/app/team-mail.ts";
import { createTeamMessageTool } from "../src/infra/team/message/index.ts";

const sub: SubagentConfig = {
	name: "worker",
	description: "",
	model: "test",
	autonomy: "inherit",
	systemPrompt: "",
	source: "user",
	filePath: "",
	warnings: [],
};

const store = new TaskStore();
let dir = "";

function record(taskId: string, status: TaskRecord["status"] = "running"): TaskRecord {
	const rec = newRecord(sub, "label", "/cwd", "background");
	rec.taskId = taskId;
	rec.status = status;
	return rec;
}

function finish(rec: TaskRecord, text: string): void {
	rec.status = "done";
	rec.result = {
		text,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
		notes: [],
	};
	store.touch();
}

beforeEach(() => {
	store.clear();
	beginTeamSession("s-mail");
	clearTeamMail();
	bindTeamMail(store);
	enableTeam();
	joinTeam("worker", "run-a");
	joinTeam("cold", "run-cold");
	dir = mkdtempSync(join(tmpdir(), "pi-team-mail-"));
	process.env.PI_SUBAGENTS_JOURNAL = join(dir, "journal.ndjson");
});

afterEach(() => {
	clearTeamMail();
	delete process.env.PI_SUBAGENTS_JOURNAL;
	rmSync(dir, { recursive: true, force: true });
});

describe("team mail: cold queue", () => {
	it("flushes queued mail when the member binds", () => {
		assert.equal(sendTeamMessage("lead", "cold", "remember this").queued, true);
		const seen: string[] = [];
		bindTeamMember("cold", "worker", (text) => seen.push(text), "run-cold");
		assert.deepEqual(seen, ["[team message] from lead: remember this"]);
		assert.equal(sendTeamMessage("lead", "cold", "live now").queued, undefined);
		assert.equal(seen.at(-1), "[team message] from lead: live now");
	});

	it("journals queued mail without text", () => {
		sendTeamMessage("lead", "cold", "quiet fact");
		const event = JSON.parse(readFileSync(process.env.PI_SUBAGENTS_JOURNAL ?? "", "utf8").trim());
		assert.equal(event.event, "team_message");
		assert.equal(event.queued, true);
		assert.equal(event.chars, 10);
		assert.equal("text" in event, false);
	});

	it("refuses a full inbox instead of dropping mail", () => {
		for (let n = 0; n < MAX_COLD_MESSAGES; n += 1) {
			assert.equal(sendTeamMessage("lead", "cold", `m${n}`).ok, true);
		}
		assert.match(sendTeamMessage("lead", "cold", "overflow").error ?? "", /inbox is full/);
	});

	it("caps cold mail by characters as well as count", () => {
		for (let n = 0; n < 3; n += 1) {
			assert.equal(sendTeamMessage("lead", "cold", "x".repeat(2_000)).ok, true);
		}
		const overflow = sendTeamMessage("lead", "cold", "y".repeat(2_000));
		assert.match(overflow.error ?? "", /inbox is full/);
	});

	it("reports a queued send through the tool", async () => {
		const tool = createTeamMessageTool(teamMessageApi);
		const result = await tool.execute(
			"id",
			{ action: "send", to: "cold", text: "later" } as never,
			undefined,
			undefined,
			undefined as never,
		);
		const body = result.content[0];
		assert.match(body?.type === "text" ? body.text : "", /Queued for cold/);
		assert.equal((result.details as { queued?: boolean }).queued, true);
	});

	it("returns a settled report for a known cold member", async () => {
		const rec = record("run-cold", "done");
		rec.result = {
			text: "cold report",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
			notes: [],
		};
		store.add(rec);
		const out = await waitForMember("lead", "cold");
		assert.equal(out.kind, "settled");
		if (out.kind === "settled") assert.equal(out.report, "cold report");
	});

	it("refuses a cold member whose last row is still running", async () => {
		store.add(record("run-cold"));
		const out = await waitForMember("lead", "cold");
		assert.equal(out.kind, "failed");
		if (out.kind === "failed") assert.match(out.error, /no live process/);
	});

	it("refuses two peers that wait on each other before the cap", async () => {
		store.add(record("run-a"));
		store.add(record("run-b"));
		bindTeamMember("a", "worker", () => {}, "run-a");
		bindTeamMember("b", "worker", () => {}, "run-b");
		const first = waitForMember("a", "b", 1_000);
		const started = Date.now();
		const second = await waitForMember("b", "a", 1_000);
		assert.equal(second.kind, "failed");
		if (second.kind === "failed") assert.match(second.error, /deadlock/);
		assert.ok(Date.now() - started < 1_000);
		finish(store.get("run-b") as TaskRecord, "b done");
		await first;
	});

	it("refuses a three-member wait cycle", async () => {
		for (const id of ["run-a", "run-b", "run-c"]) store.add(record(id));
		for (const [name, id] of [
			["a", "run-a"],
			["b", "run-b"],
			["c", "run-c"],
		] as const) {
			bindTeamMember(name, "worker", () => {}, id);
		}
		const first = waitForMember("a", "b", 1_000);
		const second = waitForMember("b", "c", 1_000);
		const third = await waitForMember("c", "a", 1_000);
		assert.equal(third.kind, "failed");
		if (third.kind === "failed") assert.match(third.error, /deadlock/);
		finish(store.get("run-c") as TaskRecord, "c done");
		await second;
		finish(store.get("run-b") as TaskRecord, "b done");
		await first;
	});

	it("removes a wait edge after a timeout", async () => {
		store.add(record("run-a"));
		store.add(record("run-b"));
		bindTeamMember("a", "worker", () => {}, "run-a");
		bindTeamMember("b", "worker", () => {}, "run-b");
		const first = await waitForMember("a", "b", 5);
		assert.equal(first.kind, "running");
		const second = await waitForMember("b", "a", 5);
		assert.equal(second.kind, "running");
	});
});
