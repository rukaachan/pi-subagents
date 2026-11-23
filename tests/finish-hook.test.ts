import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finishPayload, MAX_COMMAND_CHARS, runFinishHook } from "../src/telemetry/finish-hook.ts";

const payload = finishPayload({
	task_id: "task-1",
	subagent: "explorer",
	status: "done",
	ms: 1234,
	chars: 560,
	model: "acme/fast",
	cwd: "/tmp/project",
});

describe("finish payload", () => {
	it("is one JSON-shaped event", () => {
		assert.equal(payload.event, "subagent_end");
		assert.equal(payload.task_id, "task-1");
		assert.equal(payload.status, "done");
		assert.equal(payload.ms, 1234);
		assert.equal(payload.chars, 560);
	});

	it("clips a long error and drops a blank one", () => {
		const long = finishPayload({ ...payload, error: "x\n".repeat(400) });
		assert.ok((long.error ?? "").length <= 300);
		assert.doesNotMatch(long.error ?? "", /\n/);
		const blank = finishPayload({ ...payload, error: "   " });
		assert.equal(blank.error, undefined);
	});
});

describe("runFinishHook", () => {
	it("refuses a blank or over-long command without throwing", () => {
		assert.equal(runFinishHook("   ", payload), undefined);
		assert.equal(runFinishHook("x".repeat(MAX_COMMAND_CHARS + 1), payload), undefined);
	});

	it("survives a command that cannot start", () => {
		assert.doesNotThrow(() => runFinishHook("command-that-does-not-exist-9137", payload, 50));
	});

	it(
		"writes exactly one JSON line and sets the event env",
		{ skip: process.platform === "win32" ? "POSIX shell" : false, timeout: 5000 },
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "pi-hook-"));
			const file = join(dir, "event.json");
			const envFile = join(dir, "event.env");
			try {
				const command = `cat > ${JSON.stringify(file)}; printf %s "$PI_SUBAGENTS_EVENT" > ${JSON.stringify(envFile)}`;
				const child = runFinishHook(command, payload, 2000);
				assert.ok(child);
				await once(child, "exit");
				const lines = readFileSync(file, "utf8").trim().split("\n");
				assert.equal(lines.length, 1);
				assert.deepEqual(JSON.parse(lines[0] ?? ""), payload);
				assert.equal(readFileSync(envFile, "utf8"), "subagent_end");
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	it(
		"kills a command that runs past the timeout",
		{ skip: process.platform === "win32" ? "POSIX shell" : false, timeout: 5000 },
		async () => {
			const started = Date.now();
			const child = runFinishHook("sleep 5", payload, 100);
			assert.ok(child);
			const [code, signal] = (await once(child, "exit")) as [number | null, string | null];
			assert.ok(Date.now() - started < 2000);
			assert.ok(signal === "SIGKILL" || code !== 0);
		},
	);
});
