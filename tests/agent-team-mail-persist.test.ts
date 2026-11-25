import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	bindAgentTeamMail,
	bindAgentTeamMember,
	clearAgentTeamMail,
	coldMailSnapshot,
	MAX_COLD_MESSAGES,
	sendAgentTeamMessage,
} from "../src/app/agent-team/channel/index.ts";
import { beginAgentTeamSession, joinAgentTeam } from "../src/app/agent-team/board/index.ts";
import { restoreInto, serializeState } from "../src/app/session/index.ts";
import { InMemoryLedger } from "../src/app/session/index.ts";
import { TaskStore } from "../src/domain/task/index.ts";
import { encodeState, fileState, saveState } from "../src/infra/state/index.ts";

describe("cold team mail survives reload", () => {
	it("serializes, clears, restores, and flushes the exact lines", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-cold-mail-"));
		const file = path.join(dir, "state.json");
		const store = new TaskStore();
		bindAgentTeamMail(store);
		clearAgentTeamMail();
		beginAgentTeamSession("agent-team-a");
		joinAgentTeam("worker");
		try {
			assert.equal(sendAgentTeamMessage("lead", "worker", "first").queued, true);
			assert.equal(sendAgentTeamMessage("lead", "worker", "second").queued, true);
			assert.deepEqual(coldMailSnapshot(), {
				worker: ["[agent-team message] from lead: first", "[agent-team message] from lead: second"],
			});

			const state = serializeState(store, new InMemoryLedger());
			assert.deepEqual(state.agentTeam?.coldMail, coldMailSnapshot());
			saveState(file, encodeState(state));

			clearAgentTeamMail();
			assert.equal(coldMailSnapshot(), undefined);
			restoreInto(store, new InMemoryLedger(), file, fileState);
			assert.deepEqual(coldMailSnapshot(), {
				worker: ["[agent-team message] from lead: first", "[agent-team message] from lead: second"],
			});

			const seen: string[] = [];
			bindAgentTeamMember("worker", "worker", (line) => seen.push(line));
			assert.deepEqual(seen, [
				"[agent-team message] from lead: first",
				"[agent-team message] from lead: second",
			]);
			assert.equal(coldMailSnapshot(), undefined, "delivery removes the queue");
		} finally {
			clearAgentTeamMail();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("still refuses an overfull queue after a restore", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-cold-cap-"));
		const file = path.join(dir, "state.json");
		const store = new TaskStore();
		bindAgentTeamMail(store);
		clearAgentTeamMail();
		beginAgentTeamSession("agent-team-b");
		joinAgentTeam("worker");
		try {
			for (let i = 0; i < MAX_COLD_MESSAGES; i += 1) {
				assert.equal(sendAgentTeamMessage("lead", "worker", `m${i}`).ok, true);
			}
			saveState(file, encodeState(serializeState(store, new InMemoryLedger())));
			clearAgentTeamMail();
			restoreInto(store, new InMemoryLedger(), file, fileState);
			const over = sendAgentTeamMessage("lead", "worker", "one too many");
			assert.equal(over.ok, false);
			assert.match(over.error ?? "", /inbox is full/);
		} finally {
			clearAgentTeamMail();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
