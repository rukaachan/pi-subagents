/**
 * The prefix must reach the child's own context, not just our unit test.
 *
 * Run: PI_IT_PREFIX=1 node --experimental-strip-types --test tests/prompt-prefix-live.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MARKER = "PREFIX-MARKER-9137";

describe("the prefix reaches a real child session", () => {
	it(
		"the child's first user message starts with the prefix",
		{
			skip:
				process.env.PI_IT_PREFIX && process.env.PI_IT_MODEL
					? false
					: "set PI_IT_PREFIX=1 and PI_IT_MODEL=provider/model to run",
			timeout: 180_000,
		},
		async () => {
			const pi = await import("@earendil-works/pi-coding-agent");
			const { loadSubagentFromContent } = await import("../src/infra/subagent-files.ts");
			const { startSubagentSession } = await import("../src/infra/host-session.ts");
			const { snapshotHistory } = await import("../src/domain/run/run-result.ts");

			const cfg = loadSubagentFromContent(
				[
					"---",
					"name: probe",
					"description: prefix probe",
					"model: inherit",
					"thinkingLevel: off",
					"---",
					"",
					"Reply with exactly OK and nothing else. Do not call any tool.",
				].join("\n"),
				"probe.md",
				"user",
			);
			assert.equal(typeof cfg, "object");
			if (typeof cfg === "string") return;
			cfg.promptPrefix = `${MARKER}: keep it short.`;

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

			const dir = mkdtempSync(join(tmpdir(), "pi-prefix-live-"));
			try {
				const child = await startSubagentSession(cfg, dir, ctx);
				try {
					await child.prompt("say OK");
					const history = JSON.stringify(snapshotHistory(child.session));
					assert.ok(history.includes(MARKER), "prefix is in the child's transcript");
					assert.ok(history.includes("say OK"), "task follows the prefix");
					assert.ok(
						history.indexOf(MARKER) < history.indexOf("say OK"),
						"prefix comes before the task",
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
