/**
 * The operator's policy: one settings block, every subagent.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGlobalConfig, withGlobalConfig } from "../src/app/global-config.ts";
import { applyRunOverrides } from "../src/domain/tiers.ts";
import type { SubagentConfig } from "../src/domain/subagent/config.ts";
import { subagentAliasTool } from "../src/tools/subagent-alias.ts";
import { chainConfigs } from "../src/app/chain-task.ts";

const sub = (over: Partial<SubagentConfig> = {}): SubagentConfig => ({
	name: "probe",
	description: "d",
	model: "inherit",
	autonomy: "low",
	codemode: "only",
	systemPrompt: "p",
	source: "user",
	filePath: "/tmp/x.md",
	warnings: [],
	...over,
});

function withSettings(block: unknown): { cwd: string; agentDir: string; done: () => void } {
	const cwd = mkdtempSync(join(tmpdir(), "pi-gc-"));
	const agentDir = join(cwd, "agent");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ "pi-subagents": block }));
	return { cwd, agentDir, done: () => rmSync(cwd, { recursive: true, force: true }) };
}

describe("readGlobalConfig", () => {
	it("reads every supported knob", () => {
		const s = withSettings({
			codemode: "off",
			model: "acme/fast",
			tools: "read-only",
			autonomy: "off",
			budget: { timeoutSec: 600 },
		});
		try {
			const g = readGlobalConfig(s.cwd, s.agentDir);
			assert.equal(g.codemode, false);
			assert.equal(g.model, "acme/fast");
			assert.deepEqual(g.tools, ["read", "grep", "find", "ls"]);
			assert.equal(g.autonomy, "off");
			assert.equal(g.budget?.timeoutSec, 600);
		} finally {
			s.done();
		}
	});

	it("takes a tool list and the codemode aliases", () => {
		const s = withSettings({ codemode: "on", tools: ["read", "grep"] });
		try {
			const g = readGlobalConfig(s.cwd, s.agentDir);
			assert.equal(g.codemode, true);
			assert.deepEqual(g.tools, ["read", "grep"]);
		} finally {
			s.done();
		}
	});

	it("ignores an unknown tool id", () => {
		const s = withSettings({ tools: ["read", "not-a-tool"] });
		try {
			assert.deepEqual(readGlobalConfig(s.cwd, s.agentDir), {});
		} finally {
			s.done();
		}
	});

	it("ignores bad values and a broken file instead of failing a run", () => {
		const s = withSettings({
			codemode: "sometimes",
			model: "",
			tools: "all",
			autonomy: "god",
		});
		try {
			assert.deepEqual(readGlobalConfig(s.cwd, s.agentDir), {});
			writeFileSync(join(s.agentDir, "settings.json"), "{not json");
			assert.deepEqual(readGlobalConfig(s.cwd, s.agentDir), {});
		} finally {
			s.done();
		}
	});
});

describe("settings precedence", () => {
	it("settings win over the file, per-run wins over settings", () => {
		const file = sub({ codemode: "only", model: "inherit", tools: ["read"] });
		const global = withGlobalConfig(file, {
			codemode: false,
			model: "acme/fast",
			tools: ["read", "grep", "find", "ls", "edit", "write", "bash"],
			autonomy: "off",
			budget: { timeoutSec: 600 },
		});
		assert.equal(global.codemode, false);
		assert.equal(global.model, "acme/fast");
		assert.equal(global.autonomy, "off");
		assert.equal(global.budget?.timeoutSec, 600);
		assert.deepEqual(file.tools, ["read"], "the source config is not mutated");

		const perRun = applyRunOverrides(global, { codemode: "only", model: "acme/slow" });
		assert.equal(perRun.codemode, "only");
		assert.equal(perRun.model, "acme/slow");
	});

	it("merges a settings budget under the file's own caps", () => {
		const file = sub({ budget: { maxReportChars: 6000 } });
		const merged = withGlobalConfig(file, { budget: { timeoutSec: 600 } });
		assert.deepEqual(merged.budget, { maxReportChars: 6000, timeoutSec: 600 });
		const out = applyRunOverrides(merged, { budget: { timeoutSec: 60 } });
		assert.deepEqual(out.budget, { maxReportChars: 6000, timeoutSec: 60 });
	});
});

describe("every launch path applies the policy", () => {
	const root = new URL("..", import.meta.url).pathname;
	const paths = [
		"src/tools/task/execute.ts",
		"src/app/fanout.ts",
		"src/app/chain-task.ts",
		"src/app/background-resume.ts",
		"src/tools/subagent-alias.ts",
	];
	it("reads and applies it, so no path silently keeps the file value", () => {
		for (const path of paths) {
			const source = readFileSync(join(root, path), "utf8");
			assert.match(source, /readGlobalConfig\(/, `${path} reads the settings`);
			assert.match(source, /withGlobalConfig\(/, `${path} applies the settings`);
		}
	});

	it("chain steps take the settings and the per-run switches", () => {
		const file = sub({ codemode: "only", budget: { maxReportChars: 6000 } });
		const out = chainConfigs(
			["probe"],
			[file],
			{ codemode: false, budget: { timeoutSec: 60 } },
			{ codemode: true },
		);
		assert.equal(out[0]?.codemode, true, "per-run wins");
		assert.equal(out[0]?.budget?.timeoutSec, 60, "settings cap applies");
		assert.equal(out[0]?.budget?.maxReportChars, 6000, "file cap survives");
		assert.equal(file.codemode, "only", "the source config is not mutated");
	});

	it("the alias exposes model, complexity, and codemode", () => {
		const schema = subagentAliasTool.parameters as unknown as {
			properties: Record<string, unknown>;
		};
		for (const key of ["model", "complexity", "codemode", "budget"]) {
			assert.ok(schema.properties[key], `alias has ${key}`);
		}
		const source = readFileSync(join(root, "src/tools/subagent-alias.ts"), "utf8");
		assert.match(
			source,
			/applyRunOverrides\(withGlobalConfig\(found, readGlobalConfig\(ctx\.cwd\)\), overrides\)/,
		);
	});
});
