import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { createChildGateExtension, gateDetail } from "../src/infra/guard/index.ts";
import type { GateBlock } from "../src/infra/guard/index.ts";
import { withGateJournal } from "../src/app/guards/index.ts";

type ToolInfo = { name: string; annotations?: { destructiveHint?: boolean } };

function call(toolName: string, input: Record<string, unknown>): ToolCallEvent {
	return { type: "tool_call", toolName, toolCallId: "1", input } as unknown as ToolCallEvent;
}

function fakePi(tools: ToolInfo[] = []) {
	const handlers: Array<(event: ToolCallEvent) => Promise<unknown>> = [];
	const api = {
		on: (name: string, handler: (event: ToolCallEvent) => Promise<unknown>) => {
			if (name === "tool_call") handlers.push(handler);
		},
		getAllTools: () => tools,
	} as unknown as ExtensionAPI;
	return { api, handlers };
}

const DENIED: Array<[string, string]> = [
	["rm -rf build", "recursive delete"],
	["rm --recursive logs", "recursive delete"],
	["sudo apt install jq", "sudo"],
	["mkfs.ext4 /dev/sdb1", "filesystem format"],
	["dd if=/dev/zero of=/dev/sda bs=1M", "raw disk write"],
	["shutdown -h now", "machine power"],
	["chmod -R 777 .", "world-writable"],
	["git push --force origin main", "force push"],
	["git push -f origin main", "force push"],
	["git reset --hard HEAD~1", "hard reset"],
	["git clean -fdx", "clean untracked"],
	["echo x > /dev/sda", "block device write"],
];

const ALLOWED = [
	"ls -la",
	"npm test",
	"git status",
	"git push origin main",
	"rm build/one.txt",
	"git clean -n",
	"grep -rn needle src",
];

describe("the child gate names what a shell call would do", () => {
	it("blocks every destructive command on the list", () => {
		for (const [command, say] of DENIED) {
			const detail = gateDetail(call("bash", { command }));
			assert.ok(detail, command);
			assert.match(detail, new RegExp(say), command);
		}
	});

	it("allows ordinary commands", () => {
		for (const command of ALLOWED) {
			assert.equal(gateDetail(call("bash", { command })), undefined, command);
		}
	});

	it("applies the same list to powershell", () => {
		assert.match(String(gateDetail(call("powershell", { command: "sudo x" }))), /sudo/);
	});

	it("blocks a tool that declares destructiveHint and allows one that does not", () => {
		const tools: ToolInfo[] = [
			{ name: "wipe", annotations: { destructiveHint: true } },
			{ name: "echo", annotations: { destructiveHint: false } },
			{ name: "plain" },
		];
		assert.match(String(gateDetail(call("wipe", {}), () => tools)), /wipe may delete/);
		assert.equal(
			gateDetail(call("echo", {}), () => tools),
			undefined,
		);
		assert.equal(
			gateDetail(call("plain", {}), () => tools),
			undefined,
		);
	});

	it("never blocks a read", () => {
		assert.equal(gateDetail(call("read", { path: "a.txt" })), undefined);
	});
});

describe("the gate extension blocks and reports", () => {
	it("blocks, carries the reason, and reports the block once", async () => {
		const seen: GateBlock[] = [];
		const { api, handlers } = fakePi();
		createChildGateExtension({ record: (block) => seen.push(block) })(api);
		const result = (await handlers[0]?.(call("bash", { command: "rm -rf /" }))) as {
			block: boolean;
			reason: string;
		};
		assert.equal(result.block, true);
		assert.match(result.reason, /^gates: recursive delete \(bash\)\./);
		assert.match(result.reason, /turn gates off/);
		assert.deepEqual(seen, [{ tool: "bash", reason: "recursive delete (bash)" }]);
	});

	it("passes an ordinary call through without reporting it", async () => {
		const seen: GateBlock[] = [];
		const { api, handlers } = fakePi();
		createChildGateExtension({ record: (block) => seen.push(block) })(api);
		assert.equal(await handlers[0]?.(call("bash", { command: "ls" })), undefined);
		assert.deepEqual(seen, []);
	});

	it("reaches the journal through the app wrapper", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-gate-"));
		const journal = path.join(dir, "journal.ndjson");
		const previous = process.env.PI_SUBAGENTS_JOURNAL;
		process.env.PI_SUBAGENTS_JOURNAL = journal;
		try {
			const { api, handlers } = fakePi();
			createChildGateExtension({ record: withGateJournal().onGateBlock })(api);
			await handlers[0]?.(call("bash", { command: "sudo ls" }));
			const lines = fs
				.readFileSync(journal, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as Record<string, unknown>);
			assert.deepEqual(lines, [{ event: "gate", tool: "bash", reason: "sudo (bash)" }]);
		} finally {
			if (previous === undefined) delete process.env.PI_SUBAGENTS_JOURNAL;
			else process.env.PI_SUBAGENTS_JOURNAL = previous;
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("allows the call when a confirm dependency says yes", async () => {
		const { api, handlers } = fakePi();
		const asked: string[] = [];
		createChildGateExtension({
			confirm: async (detail) => {
				asked.push(detail);
				return true;
			},
		})(api);
		assert.equal(await handlers[0]?.(call("bash", { command: "sudo ls" })), undefined);
		assert.deepEqual(asked, ["sudo (bash)"]);
	});
});
