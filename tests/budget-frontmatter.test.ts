/**
 * The budget block in frontmatter: parsing, cutting, and the tool id.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampToolsForAutonomy } from "../src/domain/subagent/config.ts";
import { loadSubagentFromContent } from "../src/infra/subagent-files.ts";
import { planCodemode } from "../src/domain/subagent/codemode.ts";

const FRONT_WITH = (fm: string) => `---\n${fm}\n---\n\nbody\n`;
describe("budget frontmatter block", () => {
	it("parses the four fields, accepts 0 as off, and rejects typos", async () => {
		const { parseBudget } = await import("../src/domain/subagent/budget.ts");
		assert.deepEqual(parseBudget(undefined), undefined);
		assert.deepEqual(parseBudget({ timeoutSec: 900 }), { timeoutSec: 900 });
		assert.deepEqual(parseBudget({ maxTurns: 20 }), { maxTurns: 20 });
		assert.deepEqual(parseBudget({ maxInputTokens: 150000 }), { maxInputTokens: 150000 });
		assert.equal(typeof parseBudget("twenty"), "string");
		assert.match(parseBudget({ nope: 1 }) as string, /unknown budget field "nope"/);
		assert.match(parseBudget({ maxTurns: -1 }) as string, /invalid budget.maxTurns/);
		assert.deepEqual(parseBudget({ maxTurns: 0, maxInputTokens: 0 }), {
			maxTurns: 0,
			maxInputTokens: 0,
		});

		const on = loadSubagentFromContent(FRONT_WITH("name: a\nbudget: maxTurns 20"), "/x.md", "user");
		assert.match(on as string, /invalid budget/);
	});

	it("fills the system timeout when a config names none, and honors an explicit { }", async () => {
		const { DEFAULT_TIMEOUT_SEC, effectiveBudget } =
			await import("../src/domain/subagent/budget.ts");
		assert.equal(DEFAULT_TIMEOUT_SEC, 3600);
		assert.deepEqual(effectiveBudget(undefined), { timeoutSec: DEFAULT_TIMEOUT_SEC });
		assert.deepEqual(effectiveBudget({ maxReportChars: 100 }), {
			maxReportChars: 100,
			timeoutSec: DEFAULT_TIMEOUT_SEC,
		});
		assert.deepEqual(effectiveBudget({}), {});
		assert.deepEqual(effectiveBudget({ timeoutSec: 90 }), { timeoutSec: 90 });
	});
});
describe("applyReportBudget (pure cut)", () => {
	let tiny: string;
	it("passes short text untouched and cuts long text with an explicit marker", async () => {
		const { applyReportBudget } = await import("../src/domain/subagent/budget.ts");
		assert.equal(applyReportBudget("hi", undefined), "hi");
		const long = "x".repeat(150);
		const cut = applyReportBudget(long, { maxReportChars: 120 });
		assert.ok(cut.length <= 120, "cut output never exceeds the cap");
		assert.match(cut, /truncated: 30 characters over the 120-char budget\]/);
		tiny = applyReportBudget(long, { maxReportChars: 20 });
		assert.equal(tiny.length, 20);
		assert.ok(tiny.includes("truncated"), "degenerate cap still names the cut");
	});
});
describe("codemode as a nameable tool id (lane B)", () => {
	it("parses in frontmatter tools lists and needs no flag", () => {
		const md =
			"---\nname: lean\ndescription: d\nmodel: inherit\nautonomy: low\ntools: read, bash, codemode\n---\n\nbody\n";
		const cfg = loadSubagentFromContent(md, "/x.md", "user");
		assert.ok(typeof cfg !== "string", "list with codemode parses");
		assert.ok(!cfg.codemode, "the flag stays unset when only the list names it");
		const ids = planCodemode(cfg, cfg.tools);
		assert.ok(ids, "plan present when the list names codemode");
		assert.deepEqual(ids?.toolIds.indexOf("codemode") >= 0, true);
		// lean list = 3 ids: edit/write never declared
		assert.deepEqual(cfg.tools, ["read", "bash", "codemode"]);
	});

	it("read-only list keeps its clamp (scripts reach read only)", () => {
		const md =
			"---\nname: ro\ndescription: d\nmodel: inherit\nautonomy: off\ntools: read, codemode\n---\n\nbody\n";
		const cfg = loadSubagentFromContent(md, "/x.md", "user");
		assert.ok(typeof cfg !== "string", "parses");
		const clamped = clampToolsForAutonomy(cfg);
		assert.ok(
			clamped.tools && !clamped.tools.includes("codemode"),
			"autonomy off strips codemode from the list",
		);
		assert.match(clamped.notes.join(" "), /read-only/);
		const plan = planCodemode(cfg, clamped.tools);
		assert.ok(plan, "the scripting tool is granted");
		assert.equal(plan.mode, "only", "the model sees the scripting tool alone");
		for (const w of ["edit", "write", "bash", "powershell"]) {
			assert.ok(!plan.toolIds.includes(w), `the clamp holds: no ${w}`);
		}
	});
});
