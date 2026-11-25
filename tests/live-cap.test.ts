import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MAX_FINISH_HOOK_CHARS,
	parseFinishHook,
	parseLiveCap,
	readGlobalConfig,
	withGlobalConfig,
} from "../src/app/global-config.ts";
import type { SubagentConfig } from "../src/domain/subagent/index.ts";
import { TaskStore } from "../src/domain/task/index.ts";

function setup(globalBlock: unknown, projectBlock?: unknown) {
	const root = mkdtempSync(join(tmpdir(), "pi-cap-"));
	const cwd = join(root, "proj");
	const agentDir = join(root, "agent");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ "pi-subagents": globalBlock }));
	if (projectBlock !== undefined) {
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "settings.json"),
			JSON.stringify({ "pi-subagents": projectBlock }),
		);
	}
	return { cwd, agentDir, done: () => rmSync(root, { recursive: true, force: true }) };
}

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

describe("liveCap parsing", () => {
	it("accepts integers and numeric strings in range", () => {
		assert.equal(parseLiveCap(1), 1);
		assert.equal(parseLiveCap(64), 64);
		assert.equal(parseLiveCap("4"), 4);
	});

	it("ignores everything else", () => {
		for (const bad of [0, 65, -1, 2.5, "2.5", "", null, undefined, {}, [], true]) {
			assert.equal(parseLiveCap(bad), undefined, JSON.stringify(bad));
		}
	});
});

describe("finishHook parsing", () => {
	it("trims and keeps a command", () => {
		assert.equal(parseFinishHook("  notify-send done  "), "notify-send done");
	});

	it("ignores blank, non-string, and over-long values", () => {
		for (const bad of ["", "   ", 3, null, {}, "x".repeat(MAX_FINISH_HOOK_CHARS + 1)]) {
			assert.equal(parseFinishHook(bad), undefined, String(bad).slice(0, 20));
		}
	});
});

describe("settings read", () => {
	it("reads liveCap from the merged block", () => {
		const s = setup({ liveCap: 2 }, { liveCap: 3 });
		try {
			assert.equal(readGlobalConfig(s.cwd, s.agentDir).liveCap, 3);
		} finally {
			s.done();
		}
	});

	it("ignores a bad liveCap", () => {
		const s = setup({ liveCap: "many" });
		try {
			assert.equal(readGlobalConfig(s.cwd, s.agentDir).liveCap, undefined);
		} finally {
			s.done();
		}
	});

	it("takes the hook from global settings unless the project is trusted", () => {
		const s = setup({ finishHook: "global-hook" }, { finishHook: "project-hook" });
		try {
			assert.equal(readGlobalConfig(s.cwd, s.agentDir).finishHook, "global-hook");
			assert.equal(
				readGlobalConfig(s.cwd, s.agentDir, { trusted: true }).finishHook,
				"project-hook",
			);
		} finally {
			s.done();
		}
	});

	it("finds no hook when only the project sets one and trust is off", () => {
		const s = setup({}, { finishHook: "project-only" });
		try {
			assert.equal(readGlobalConfig(s.cwd, s.agentDir).finishHook, undefined);
			assert.equal(
				readGlobalConfig(s.cwd, s.agentDir, { trusted: true }).finishHook,
				"project-only",
			);
		} finally {
			s.done();
		}
	});
});

describe("withGlobalConfig", () => {
	it("copies the hook without touching the source config", () => {
		const base = sub();
		const next = withGlobalConfig(base, { finishHook: "notify" });
		assert.equal(next.finishHook, "notify");
		assert.equal(base.finishHook, undefined);
	});

	it("leaves the hook off when settings have none", () => {
		assert.equal(withGlobalConfig(sub(), {}).finishHook, undefined);
	});
});

describe("the store cap", () => {
	it("uses the number it is given", () => {
		const store = new TaskStore();
		store.add({ taskId: "t1", status: "running" } as never);
		assert.equal(store.canStart(1), false);
		assert.equal(store.canStart(2), true);
		assert.equal(store.canStart(), true);
	});
});
