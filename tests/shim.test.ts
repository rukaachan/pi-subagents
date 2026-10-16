import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { subagentArgs, taskArgs } from "../src/infra/host-shim.ts";

describe("taskArgs", () => {
	it("keeps the canonical shape", () => {
		const out = taskArgs({ subagent_type: "explorer", description: "d", prompt: "p" });
		assert.equal(out.subagent_type, "explorer");
		assert.equal(out.description, "d");
		assert.equal(out.prompt, "p");
	});

	it("maps agent/task aliases", () => {
		const out = taskArgs({ agent: "explorer", task: "do it" });
		assert.equal(out.subagent_type, "explorer");
		assert.equal(out.prompt, "do it");
		assert.ok(typeof out.description === "string");
	});

	it("empties missing keys for handler errors", () => {
		const out = taskArgs({});
		assert.equal(out.subagent_type, "");
		assert.equal(out.prompt, "");
	});

	it("keeps background keys", () => {
		const out = taskArgs({ agent: "w", task: "t", run_in_background: true });
		assert.equal(out.run_in_background, true);
	});

	it("maps bare background to run_in_background", () => {
		const out = taskArgs({ agent: "worker", task: "t", background: true });
		assert.equal(out.run_in_background, true);
		assert.equal(out.subagent_type, "worker");
	});

	it("keeps the alias per-run switches", () => {
		const out = subagentArgs({
			agent: "w",
			task: "t",
			model: "acme/1",
			complexity: "light",
			codemode: "off",
			budget: { timeoutSec: 60 },
		});
		assert.equal(out.model, "acme/1");
		assert.equal(out.complexity, "light");
		assert.equal(out.codemode, "off");
		assert.deepEqual(out.budget, { timeoutSec: 60 });
	});

	it("keeps per-run model, complexity, and codemode", () => {
		const out = taskArgs({
			agent: "w",
			task: "t",
			model: "acme/1",
			complexity: "heavy",
			codemode: "off",
		});
		assert.equal(out.model, "acme/1");
		assert.equal(out.complexity, "heavy");
		assert.equal(out.codemode, "off");
	});

	it("reads a string chain", () => {
		const out = taskArgs({ chain: ["explorer", "worker"], prompt: "ship it" });
		assert.deepEqual(out.chain, ["explorer", "worker"]);
		assert.equal(out.prompt, "ship it");
	});

	it("reads an object chain and joins its prompts", () => {
		const out = taskArgs({
			chain: [
				{ subagent_type: "explorer", prompt: "map it" },
				{ agent: "worker", task: "fix it" },
			],
			description: "two step",
		});
		assert.deepEqual(out.chain, ["explorer", "worker"]);
		assert.equal(out.prompt, "map it\nfix it");
	});

	it("ignores an empty chain", () => {
		const out = taskArgs({ agent: "w", task: "t", chain: [] });
		assert.equal(out.chain, undefined);
		assert.equal(out.subagent_type, "w");
	});

	it("reads a string parallel list", () => {
		const out = taskArgs({ parallel: ["explorer", "tester"], prompt: "look" });
		assert.deepEqual(out.parallel, ["explorer", "tester"]);
		assert.equal(out.prompt, "look");
	});

	it("reads an object parallel list", () => {
		const out = taskArgs({
			parallel: [{ subagent_type: "explorer", prompt: "map it" }, { agent: "tester" }],
			prompt: "same goal",
		});
		assert.deepEqual(out.parallel, [{ subagent_type: "explorer", prompt: "map it" }, "tester"]);
		assert.equal(out.prompt, "map it");
	});

	it("ignores an empty parallel list", () => {
		const out = taskArgs({ agent: "w", task: "t", parallel: [] });
		assert.equal(out.parallel, undefined);
		assert.equal(out.subagent_type, "w");
	});
});

describe("subagentArgs", () => {
	it("maps Task-style keys", () => {
		const out = subagentArgs({ subagent_type: "explorer", prompt: "do it" });
		assert.equal(out.agent, "explorer");
		assert.equal(out.task, "do it");
	});

	it("accepts description as the task text", () => {
		const out = subagentArgs({ agent: "explore", description: "Map repo structure" });
		assert.equal(out.agent, "explore");
		assert.equal(out.task, "Map repo structure");
	});

	it("empties missing keys for handler errors", () => {
		const out = subagentArgs({});
		assert.equal(out.agent, "");
		assert.equal(out.task, "");
	});

	it("keeps tasks for the unsupported path", () => {
		const out = subagentArgs({ agent: "a", task: "t", tasks: [] });
		assert.ok("tasks" in out);
	});

	it("maps a chain to names and keeps the task text", () => {
		const out = subagentArgs({ chain: ["explorer", "worker"], task: "ship it" });
		assert.deepEqual(out.chain, ["explorer", "worker"]);
		assert.equal(out.task, "ship it");
	});
});
