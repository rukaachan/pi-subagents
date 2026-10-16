/**
 * The codemode flag: what a frontmatter file may say about it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampToolsForAutonomy, type SubagentConfig } from "../src/domain/subagent/config.ts";
import { loadSubagentFromContent } from "../src/infra/subagent-files.ts";
import { parseCodemodeFlag } from "../src/domain/subagent/frontmatter.ts";
import { planCodemode } from "../src/domain/subagent/codemode.ts";

const FRONT = (fm: string) => `---\n${fm}\n---\n\nbody text\n`;
const sub = (over: Partial<SubagentConfig> = {}): SubagentConfig => ({
	name: "probe",
	description: "d",
	model: "inherit",
	autonomy: "low",
	systemPrompt: "p",
	source: "user",
	filePath: "/tmp/x.md",
	warnings: [],
	...over,
});
describe("codemode frontmatter flag", () => {
	it("accepts true/false, off/on, only, and absence, rejects everything else", () => {
		assert.equal(parseCodemodeFlag(true).mode, true);
		assert.equal(parseCodemodeFlag(false).mode, false);
		assert.equal(parseCodemodeFlag("on").mode, true);
		assert.equal(parseCodemodeFlag("off").mode, false);
		assert.equal(parseCodemodeFlag("only").mode, "only");
		assert.equal(parseCodemodeFlag(undefined).mode, undefined);
		assert.equal(parseCodemodeFlag(null).mode, undefined);
		assert.equal(parseCodemodeFlag("").mode, undefined);
		assert.match(parseCodemodeFlag("yes").error ?? "", /invalid codemode yes/);
	});

	it("round-trips through the file loader", () => {
		const on = loadSubagentFromContent(FRONT("name: a\ncodemode: true"), "/x.md", "user");
		assert.ok(typeof on !== "string", "codemode: true parses");
		assert.ok(on.codemode === true);

		const off = loadSubagentFromContent(FRONT("name: a"), "/x.md", "user");
		assert.ok(typeof off !== "string");
		assert.ok(!(off.codemode === true), "absent stays undefined");

		const bad = loadSubagentFromContent(FRONT("name: a\ncodemode: yes"), "/x.md", "user");
		assert.match(bad as string, /invalid codemode/);
	});
});
describe("planCodemode (pure runtime plan)", () => {
	it("gives every plain subagent the scripting tool alone", () => {
		const plan = planCodemode(sub(), ["read", "grep"]);
		assert.ok(plan, "the scripting tool is the default");
		assert.equal(plan.mode, "only");
		assert.deepEqual(plan.toolIds, ["read", "grep", "codemode"]);
	});

	it("codemode false is the way out", () => {
		assert.equal(planCodemode(sub({ codemode: false }), ["read", "grep"]), null);
	});

	it("appends the codemode tool id for an all-tools subagent", () => {
		const plan = planCodemode(sub({ codemode: true }), undefined);
		assert.ok(plan, "plan exists");
		assert.ok(plan.addCodemodeTool);
		assert.ok(plan.toolIds.includes("codemode"));
		assert.equal(plan.toolIds.filter((t) => t === "codemode").length, 1, "no duplicate id");
	});

	it("passes through when the id list already names codemode", () => {
		const plan = planCodemode(sub({ codemode: true, tools: ["read", "codemode"] }), [
			"read",
			"codemode",
		]);
		assert.ok(plan);
		assert.deepEqual(plan.toolIds, ["read", "codemode"]);
	});

	it("read-only clamp surfaces a runner note when the flag was set", async () => {
		const cfg = sub({
			autonomy: "off",
			codemode: true,
			tools: ["read", "bash"],
			systemPrompt: "p",
		});
		const note = async () => clampToolsForAutonomy(cfg).notes.join(" ");
		assert.match(await note(), /read-only/);
	});

	it("a read-only clamp keeps the scripts read-only", () => {
		const clamped = clampToolsForAutonomy(
			sub({ autonomy: "off", codemode: true, tools: ["read", "bash"] }),
		);
		const plan = planCodemode(
			sub({ codemode: true, autonomy: "off", tools: ["read", "bash"] }),
			clamped.tools,
		);
		assert.ok(plan, "the scripting tool is granted");
		for (const w of ["bash", "edit", "write"]) {
			assert.ok(!plan.toolIds.includes(w), `the clamp holds: no ${w}`);
		}
		assert.match(clamped.notes.join(" "), /read-only/);
	});

	it("grants codemode to an explicitly read-only list (clamp holds by construction)", () => {
		const listed = ["read", "grep", "find", "ls", "codemode"];
		const plan = planCodemode(sub({ codemode: true, tools: listed }), listed);
		assert.ok(plan, "explicit read-only list with codemode is granted");
		assert.deepEqual(plan.toolIds, listed, "no id added, no id removed");
		for (const w of ["bash", "edit", "write", "powershell"]) {
			assert.ok(!plan.toolIds.includes(w), `read-only codemode never carries ${w}`);
		}
	});

	it("flipping the flag flips the mode (falsifier)", () => {
		const clamped: string[] = ["read", "edit", "write"];
		const plain = planCodemode(sub(), clamped);
		assert.ok(plain && plain.mode === "only", "the default is scripting alone");
		const beside = planCodemode(sub({ codemode: true }), clamped);
		assert.ok(beside && beside.mode === "on", "true keeps pi's default");
		const off = planCodemode(sub({ codemode: false }), clamped);
		assert.equal(off, null, "false means no scripting");
	});
});
