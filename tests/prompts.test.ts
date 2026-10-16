import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadSubagentFromContent } from "../src/infra/subagent-files.ts";

const STARTER_DIR = path.join(import.meta.dirname, "..", "subagents");
const READ_ONLY = ["read", "grep", "find", "ls"];

const SECTIONS = ["Method:", "Evidence:", "Scope:", "Report:"] as const;

function starters(): { name: string; content: string }[] {
	return fs
		.readdirSync(STARTER_DIR)
		.filter((f) => f.endsWith(".md"))
		.toSorted()
		.map((f) => ({ name: f, content: fs.readFileSync(path.join(STARTER_DIR, f), "utf8") }));
}

function body(content: string): string {
	return content.split("---")[2] ?? "";
}

describe("starter prompts", () => {
	it("ships the expected set", () => {
		assert.deepEqual(
			starters().map((s) => s.name),
			["code-reviewer.md", "explorer.md", "planner.md", "researcher.md", "tester.md", "worker.md"],
		);
	});

	it("loads every starter as a valid subagent", () => {
		for (const { name, content } of starters()) {
			const r = loadSubagentFromContent(content, name, "user");
			if (typeof r === "string") assert.fail(`${name} must load, got: ${r}`);
			assert.ok(r.description.length > 10, `${name} needs a real description`);
		}
	});

	it("gives every prompt the same section shape", () => {
		for (const { name, content } of starters()) {
			const text = body(content);
			for (const section of SECTIONS) {
				assert.ok(text.includes(section), `${name} is missing the ${section} section`);
			}
			assert.match(text, /^You are the \w[\w-]* subagent\./m, `${name} needs a stance line`);
		}
	});

	it("states what to do when blocked", () => {
		for (const { name, content } of starters()) {
			assert.match(
				body(content),
				/Report back\./,
				`${name} must say how to hand a blocked run back`,
			);
		}
	});

	it("keeps read-only claims and the tools list in step", () => {
		for (const { name, content } of starters()) {
			const r = loadSubagentFromContent(content, name, "user");
			if (typeof r === "string") assert.fail(`${name} must load, got: ${r}`);
			const claimsReadOnly = r.autonomy === "low" || r.systemPrompt.includes("read-only tools");
			const optedIn = r.codemode === true || r.codemode === "only";
			if (claimsReadOnly && !optedIn) {
				assert.deepEqual(
					r.tools,
					READ_ONLY,
					`${name} says read-only, so its tools must be exactly the read-only group`,
				);
			}
			if (claimsReadOnly && optedIn) {
				// The list must name codemode, so the grant is explicit.
				assert.ok(
					r.tools && r.tools.includes("codemode"),
					`${name} opted into codemode, so its list must name it`,
				);
				assert.ok(
					r.tools.includes("read"),
					`${name} opted into codemode, so its list must carry read`,
				);
				for (const w of ["edit", "write", "powershell"]) {
					assert.ok(
						!r.tools.includes(w),
						`${name} says read-only, so its list must not carry ${w}`,
					);
				}
				if (r.tools.includes("bash")) {
					assert.ok(
						r.systemPrompt.includes("Do not change files"),
						`${name} carries bash, so the prompt must forbid file changes`,
					);
				}
			}
		}
	});
});
