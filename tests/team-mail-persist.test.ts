import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	bindTeamMail,
	bindTeamMember,
	clearTeamMail,
	coldMailSnapshot,
	MAX_COLD_MESSAGES,
	sendTeamMessage,
} from "../src/app/team/channel/index.ts";
import { beginTeamSession, joinTeam } from "../src/app/team/board/index.ts";
import { restoreInto, serializeState } from "../src/app/session/index.ts";
import { InMemoryLedger } from "../src/app/session/index.ts";
import { TaskStore } from "../src/domain/task/index.ts";
import { encodeState, saveState } from "../src/infra/state/index.ts";

describe("cold team mail survives reload", () => {
	it("serializes, clears, restores, and flushes the exact lines", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-cold-mail-"));
		const file = path.join(dir, "state.json");
		const store = new TaskStore();
		bindTeamMail(store);
		clearTeamMail();
		beginTeamSession("team-a");
		joinTeam("worker");
		try {
			assert.equal(sendTeamMessage("lead", "worker", "first").queued, true);
			assert.equal(sendTeamMessage("lead", "worker", "second").queued, true);
			assert.deepEqual(coldMailSnapshot(), {
				worker: ["[team message] from lead: first", "[team message] from lead: second"],
			});

			const state = serializeState(store, new InMemoryLedger());
			assert.deepEqual(state.team?.coldMail, coldMailSnapshot());
			saveState(file, encodeState(state));

			clearTeamMail();
			assert.equal(coldMailSnapshot(), undefined);
			restoreInto(store, new InMemoryLedger(), file);
			assert.deepEqual(coldMailSnapshot(), {
				worker: ["[team message] from lead: first", "[team message] from lead: second"],
			});

			const seen: string[] = [];
			bindTeamMember("worker", "worker", (line) => seen.push(line));
			assert.deepEqual(seen, [
				"[team message] from lead: first",
				"[team message] from lead: second",
			]);
			assert.equal(coldMailSnapshot(), undefined, "delivery removes the queue");
		} finally {
			clearTeamMail();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("still refuses an overfull queue after a restore", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-cold-cap-"));
		const file = path.join(dir, "state.json");
		const store = new TaskStore();
		bindTeamMail(store);
		clearTeamMail();
		beginTeamSession("team-b");
		joinTeam("worker");
		try {
			for (let i = 0; i < MAX_COLD_MESSAGES; i += 1) {
				assert.equal(sendTeamMessage("lead", "worker", `m${i}`).ok, true);
			}
			saveState(file, encodeState(serializeState(store, new InMemoryLedger())));
			clearTeamMail();
			restoreInto(store, new InMemoryLedger(), file);
			const over = sendTeamMessage("lead", "worker", "one too many");
			assert.equal(over.ok, false);
			assert.match(over.error ?? "", /inbox is full/);
		} finally {
			clearTeamMail();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
