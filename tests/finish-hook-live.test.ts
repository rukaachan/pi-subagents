/**
 * The hook must fire from the real finish path, with the resolved config.
 *
 * Run: PI_IT_HOOK=1 node --experimental-strip-types --test tests/finish-hook-live.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("a real run fires the finish hook", () => {
	it(
		"writes one event with the subagent, status, and task id",
		{
			skip:
				process.env.PI_IT_HOOK && process.env.PI_IT_MODEL
					? false
					: "set PI_IT_HOOK=1 and PI_IT_MODEL=provider/model to run",
			timeout: 180_000,
		},
		async () => {
			const pi = await import("@earendil-works/pi-coding-agent");
			const { loadSubagentFromContent } = await import("../src/infra/subagent-files.ts");
			const { runSubagent } = await import("../src/app/run.ts");

			const cfg = loadSubagentFromContent(
				[
					"---",
					"name: probe",
					"description: hook probe",
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

			type AnyRegistry = { find(provider: string, id: string): unknown };
			const runtime = await (
				pi as unknown as { ModelRuntime: { create(): Promise<unknown> } }
			).ModelRuntime.create();
			const modelRegistry = new (
				pi as unknown as { ModelRegistry: new (r: unknown) => AnyRegistry }
			).ModelRegistry(runtime);
			const ctx = {
				ui: { setStatus() {} },
				model: modelRegistry.find(
					(process.env.PI_IT_MODEL ?? "").split("/")[0] ?? "",
					(process.env.PI_IT_MODEL ?? "").split("/")[1] ?? "",
				),
				thinkingLevel: "off",
				modelRegistry,
			} as never;

			const dir = mkdtempSync(join(tmpdir(), "pi-hook-live-"));
			const file = join(dir, "event.json");
			cfg.finishHook = `cat > ${JSON.stringify(file)}`;
			try {
				await runSubagent(cfg, "say OK", dir, ctx, undefined, "probe-key");
				for (let i = 0; i < 60 && !existsSync(file); i += 1) {
					await new Promise<void>((resolve) => {
						setTimeout(resolve, 50);
					});
				}
				assert.ok(existsSync(file), "the hook wrote its event");
				const raw = readFileSync(file, "utf8").trim();
				assert.equal(raw.split("\n").length, 1);
				const event = JSON.parse(raw) as Record<string, unknown>;
				assert.equal(event.event, "subagent_end");
				assert.equal(event.subagent, "probe");
				assert.equal(event.status, "done");
				assert.equal(event.task_id, "probe-key");
				assert.equal(event.cwd, dir);
				assert.ok(Number(event.ms) >= 0);
				assert.ok(Number(event.chars) > 0);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);
});
