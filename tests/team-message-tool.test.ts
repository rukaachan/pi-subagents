import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SubagentConfig } from "../src/domain/subagent/index.ts";
import type { TaskRecord } from "../src/domain/task/index.ts";
import { newRecord } from "../src/domain/task/index.ts";
import { TaskStore } from "../src/domain/task/index.ts";
import { beginTeamSession, enableTeam, joinTeam } from "../src/app/team-store.ts";
import {
	bindTeamMail,
	bindTeamMember,
	clearTeamMail,
	setLeadInbox,
	teamMessageApi,
} from "../src/app/team-mail.ts";
import { createTeamMessageTool } from "../src/infra/team-message-tool.ts";

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

function record(taskId: string, status: TaskRecord["status"] = "running"): TaskRecord {
	const rec = newRecord(sub, "label", "/cwd", "background");
	rec.taskId = taskId;
	rec.status = status;
	return rec;
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content[0]?.text ?? "";
}

beforeEach(() => {
	store.clear();
	beginTeamSession("s-message");
	clearTeamMail();
	bindTeamMail(store);
	enableTeam();
	joinTeam("worker", "run-a");
});

describe("TeamMessage tool", () => {
	it("sends to a live teammate and to the lead", async () => {
		const seen: string[] = [];
		bindTeamMember("worker", "worker", (line) => seen.push(line), "run-a");
		const lead = createTeamMessageTool(teamMessageApi);
		const sent = await lead.execute(
			"id",
			{ action: "send", to: "worker", text: "hello" } as never,
			undefined,
			undefined,
			undefined as never,
		);
		assert.match(text(sent), /Sent to worker/);
		assert.deepEqual(seen, ["[team message] from lead: hello"]);
		setLeadInbox((line) => seen.push(line));
		const child = createTeamMessageTool(teamMessageApi, "worker");
		await child.execute(
			"id",
			{ action: "send", to: "lead", text: "found it" } as never,
			undefined,
			undefined,
			undefined as never,
		);
		assert.equal(seen.at(-1), "[team message] from worker: found it");
	});

	it("returns a settled report and times out as still running", async () => {
		const done = record("run-a", "done");
		done.result = {
			text: "all good",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
			notes: [],
		};
		store.add(done);
		bindTeamMember("worker", "worker", () => {}, "run-a");
		const tool = createTeamMessageTool(teamMessageApi);
		const settled = await tool.execute(
			"id",
			{ action: "wait", to: "worker" } as never,
			undefined,
			undefined,
			undefined as never,
		);
		assert.match(text(settled), /worker done · run-a/);
		assert.match(text(settled), /all good/);

		const running = record("run-b");
		store.add(running);
		bindTeamMember("worker", "worker", () => {}, "run-b");
		const pending = await tool.execute(
			"id",
			{ action: "wait", to: "worker", timeout_ms: 10 } as never,
			undefined,
			undefined,
			undefined as never,
		);
		assert.match(text(pending), /still running/);
	});

	it("refuses a cold target, missing text, and a chain member", async () => {
		const tool = createTeamMessageTool(teamMessageApi);
		const cold = await tool.execute(
			"id",
			{ action: "send", to: "ghost", text: "hi" } as never,
			undefined,
			undefined,
			undefined as never,
		);
		assert.equal(cold.isError, true);
		assert.match(text(cold), /No member named/);
		const empty = await tool.execute(
			"id",
			{ action: "send", to: "worker" } as never,
			undefined,
			undefined,
			undefined as never,
		);
		assert.equal(empty.isError, true);
		assert.match(text(empty), /needs text/);
		joinTeam("chainy", "run-chain");
		bindTeamMember("chainy", "worker", () => {}, undefined, true);
		const chain = await tool.execute(
			"id",
			{ action: "wait", to: "chainy" } as never,
			undefined,
			undefined,
			undefined as never,
		);
		assert.equal(chain.isError, true);
		assert.match(text(chain), /chain/);
	});
});
