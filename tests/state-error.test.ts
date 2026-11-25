import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { attachPersistence, reportStateError, SAVE_DEBOUNCE_MS } from "../src/app/session/index.ts";
import { InMemoryLedger } from "../src/app/session/index.ts";
import { TaskStore } from "../src/domain/task/index.ts";
import { fileState } from "../src/infra/state/index.ts";

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

describe("state write failures are visible", () => {
	it("reports once, keeps the run alive, and journals the error", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-state-error-"));
		const blocker = path.join(dir, "not-a-directory");
		fs.writeFileSync(blocker, "x");
		const statePath = path.join(blocker, "nested", "state.json");
		const store = new TaskStore();
		const errors: string[] = [];
		const off = attachPersistence(store, new InMemoryLedger(), fileState, statePath, (message) =>
			errors.push(message),
		);
		try {
			store.touch();
			await wait(SAVE_DEBOUNCE_MS + 200);
			assert.equal(errors.length, 1);
			assert.match(errors[0] ?? "", /ENOTDIR|not a directory/);
			store.touch();
			off();
			assert.equal(errors.length, 1, "the same message is not repeated");
		} finally {
			off();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reportStateError writes one state_error line and calls the notifier", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-state-log-"));
		const journalPath = path.join(dir, "journal.ndjson");
		const before = process.env.PI_SUBAGENTS_JOURNAL;
		process.env.PI_SUBAGENTS_JOURNAL = journalPath;
		const notes: string[] = [];
		try {
			reportStateError("ENOTDIR: blocked", (message) => notes.push(message));
			assert.deepEqual(notes, ["ENOTDIR: blocked"]);
			const lines = fs
				.readFileSync(journalPath, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as Record<string, unknown>);
			assert.deepEqual(lines, [{ event: "state_error", message: "ENOTDIR: blocked" }]);
		} finally {
			if (before === undefined) delete process.env.PI_SUBAGENTS_JOURNAL;
			else process.env.PI_SUBAGENTS_JOURNAL = before;
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
