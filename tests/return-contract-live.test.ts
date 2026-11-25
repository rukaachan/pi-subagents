/**
 * The contract must reach the child's own prompt, not just our unit test.
 *
 * Run: PI_IT_CONTRACT=1 node --experimental-strip-types --test tests/return-contract-live.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TASK = "Reply with exactly OK and nothing else. Do not call any tool.";

describe("the return contract reaches a real child session", () => {
	it(
		"the child's prompt names the required fields after the task",
		{
			skip:
				process.env.PI_IT_CONTRACT && process.env.PI_IT_MODEL
					? false
					: "set PI_IT_CONTRACT=1 and PI_IT_MODEL=provider/model to run",
			timeout: 180_000,
		},
		async () => {
			const pi = await import("@earendil-works/pi-coding-agent");
			const { loadSubagentFromContent } = await import("../src/infra/files/subagent-files.ts");
			const { startSubagentSession } = await import("../src/infra/host/session/host-session.ts");
			const { snapshotHistory } = await import("../src/domain/run/run-result.ts");

			const cfg = loadSubagentFromContent(
				[
					"---",
					"name: probe",
					"description: contract probe",
					"model: inherit",
					"thinkingLevel: off",
					"---",
					"",
					"Answer in one short line. Do not call any tool.",
				].join("\n"),
				"probe.md",
				"user",
			);
			assert.equal(typeof cfg, "object");
			if (typeof cfg === "string") return;

			type AnyRegistry = { find(provider: string, id: string): unknown };
			const runtime = await (
				pi as unknown as { ModelRuntime: { create(): Promise<unknown> } }
			).ModelRuntime.create();
			const modelRegistry = new (
				pi as unknown as { ModelRegistry: new (r: unknown) => AnyRegistry }
			).ModelRegistry(runtime);
			const ctx = {
				ui: {},
				model: modelRegistry.find(
					(process.env.PI_IT_MODEL ?? "").split("/")[0] ?? "",
					(process.env.PI_IT_MODEL ?? "").split("/")[1] ?? "",
				),
				thinkingLevel: "off",
				modelRegistry,
			} as never;

			const dir = mkdtempSync(join(tmpdir(), "pi-contract-live-"));
			try {
				const child = await startSubagentSession(cfg, dir, ctx);
				try {
					await child.prompt(TASK, ["files", "risks"]);
					const history = JSON.stringify(snapshotHistory(child.session));
					assert.ok(history.includes("Required fields: files, risks"), "contract is in the prompt");
					assert.ok(history.includes(TASK), "task is in the prompt");
					assert.ok(
						history.indexOf(TASK) < history.indexOf("Required fields"),
						"the contract comes after the task",
					);
				} finally {
					child.session.dispose();
				}
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);
});
