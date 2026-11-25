import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubagentConfig } from "../src/domain/subagent/index.ts";
import type { TaskRecord } from "../src/domain/task/index.ts";
import { newRecord } from "../src/domain/task/index.ts";
import { TaskStore } from "../src/domain/task/index.ts";
import { beginTeamSession, enableTeam, joinTeam } from "../src/app/team/board/index.ts";
import {
	bindTeamMail,
	bindTeamMember,
	clearTeamMail,
	sendTeamMessage,
	setLeadInbox,
	waitForMember,
} from "../src/app/team/channel/index.ts";

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

describe("team mail: send", () => {
	it("steers a live member and journals no text", () => {
		const seen: string[] = [];
		bindTeamMember("worker", "worker", (text) => seen.push(text), "run-a");
		const sent = sendTeamMessage("lead", "worker", "look at src/app");
		assert.equal(sent.ok, true);
		assert.equal(sent.chars, 15);
		assert.deepEqual(seen, ["[team message] from lead: look at src/app"]);
		const event = JSON.parse(readFileSync(process.env.PI_SUBAGENTS_JOURNAL ?? "", "utf8").trim());
		assert.equal(event.event, "team_message");
		assert.equal(event.from, "lead");
		assert.equal(event.to, "worker");
		assert.equal(event.chars, 15);
		assert.equal("text" in event, false);
	});

	it("refuses self, empty, and unknown targets", () => {
		assert.match(sendTeamMessage("worker", "worker", "hi").error ?? "", /yourself/);
		assert.match(sendTeamMessage("lead", "worker", "  ").error ?? "", /needs text/);
		assert.match(sendTeamMessage("lead", "ghost", "hi").error ?? "", /No member named/);
	});

	it("caps a long message at 2,000 characters", () => {
		const seen: string[] = [];
		bindTeamMember("worker", "worker", (text) => seen.push(text), "run-a");
		const sent = sendTeamMessage("lead", "worker", "x".repeat(2_500));
		assert.equal(sent.ok, true);
		assert.equal(sent.chars, 2_000);
		assert.equal(sent.truncated, true);
		assert.equal(seen[0]?.length, "[team message] from lead: ".length + 2_000);
	});

	it("wakes the lead and refuses when the lead is not listening", () => {
		assert.match(sendTeamMessage("worker", "lead", "done").error ?? "", /not listening/);
		const seen: string[] = [];
		setLeadInbox((text) => seen.push(text));
		assert.equal(sendTeamMessage("worker", "lead", "done").ok, true);
		assert.deepEqual(seen, ["[team message] from worker: done"]);
	});
});

describe("team mail: wait", () => {
	it("returns a settled report at once", async () => {
		const rec = record("run-a", "done");
		rec.result = {
			text: "all good",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
			notes: [],
		};
		store.add(rec);
		bindTeamMember("worker", "worker", () => {}, "run-a");
		const out = await waitForMember("lead", "worker");
		assert.equal(out.kind, "settled");
		if (out.kind === "settled") {
			assert.equal(out.status, "done");
			assert.equal(out.report, "all good");
		}
	});

	it("resolves when a running row settles", async () => {
		const rec = record("run-a");
		store.add(rec);
		bindTeamMember("worker", "worker", () => {}, "run-a");
		const pending = waitForMember("lead", "worker", 1_000);
		setTimeout(() => finish(rec, "late report"), 10);
		const out = await pending;
		assert.equal(out.kind, "settled");
		if (out.kind === "settled") assert.equal(out.report, "late report");
	});

	it("times out as still running, not an error", async () => {
		store.add(record("run-a"));
		bindTeamMember("worker", "worker", () => {}, "run-a");
		const out = await waitForMember("lead", "worker", 20);
		assert.equal(out.kind, "running");
		if (out.kind === "running") assert.equal(out.taskId, "run-a");
	});

	it("refuses a chain member, a cold member, the lead, and self", async () => {
		joinTeam("chainy", "run-chain");
		bindTeamMember("chainy", "worker", () => {}, undefined, true);
		const chain = await waitForMember("lead", "chainy");
		assert.equal(chain.kind, "failed");
		if (chain.kind === "failed") assert.match(chain.error, /chain/);
		const cold = await waitForMember("lead", "cold");
		assert.equal(cold.kind, "failed");
		if (cold.kind === "failed") assert.match(cold.error, /settle card/);
		const lead = await waitForMember("worker", "lead");
		assert.equal(lead.kind, "failed");
		if (lead.kind === "failed") assert.match(lead.error, /lead/);
		const self = await waitForMember("worker", "worker");
		assert.equal(self.kind, "failed");
		if (self.kind === "failed") assert.match(self.error, /yourself/);
	});

	it("caps a huge report", async () => {
		const rec = record("run-a", "done");
		rec.result = {
			text: "x".repeat(50_000),
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
			notes: [],
		};
		store.add(rec);
		bindTeamMember("worker", "worker", () => {}, "run-a");
		const out = await waitForMember("lead", "worker");
		assert.equal(out.kind, "settled");
		if (out.kind === "settled") {
			assert.match(out.report, /truncated 10000 chars/);
			assert.ok(out.report.length < 40_100);
		}
	});
});
