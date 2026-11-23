import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	checkReturn,
	contractPrompt,
	MAX_RETURN_FIELDS,
	MAX_RETURN_FIELD_CHARS,
	missingReturn,
	parseReturn,
} from "../src/domain/subagent/contract.ts";
import { planTask } from "../src/tools/task/validate.ts";

describe("return contract parsing", () => {
	it("treats no value as no contract", () => {
		assert.deepEqual(parseReturn(undefined), { fields: [] });
	});

	it("keeps the first casing and drops duplicates", () => {
		const parsed = parseReturn(["Files", "files", "RISKS"]);
		assert.deepEqual(parsed, { fields: ["Files", "RISKS"] });
	});

	it("trims and collapses whitespace", () => {
		assert.deepEqual(parseReturn(["  next   step "]), { fields: ["next step"] });
	});

	it("refuses malformed input with a reason", () => {
		for (const bad of ["files", 3, null, {}, [], [" "], [""], [1], ["a", null]]) {
			const parsed = parseReturn(bad);
			assert.ok("error" in parsed, JSON.stringify(bad));
			assert.ok(parsed.error.length > 10, parsed.error);
		}
	});

	it("caps the field name and the count", () => {
		const long = parseReturn(["x".repeat(MAX_RETURN_FIELD_CHARS + 1)]);
		assert.ok("error" in long);
		const many = parseReturn(Array.from({ length: MAX_RETURN_FIELDS + 1 }, (_, i) => `f${i}`));
		assert.ok("error" in many);
		const exact = Array.from({ length: MAX_RETURN_FIELDS }, (_, i) => `f${i}`);
		assert.deepEqual(parseReturn(exact), { fields: exact });
	});
});

describe("return contract prompt", () => {
	it("adds nothing when no field was named", () => {
		assert.equal(contractPrompt([]), "");
	});

	it("names every field and the line shape", () => {
		const text = contractPrompt(["files", "risks"]);
		assert.match(text, /End the report with one line per field/);
		assert.match(text, /<field>: <value>/);
		assert.match(text, /Required fields: files, risks$/);
	});
});

describe("return contract check", () => {
	const accepts: Array<[string, string[]]> = [
		["files: a", ["files"]],
		["report\n\nfiles: a\nrisks: none", ["files", "risks"]],
		["FILES: a\nRISKS: none", ["files", "risks"]],
		["files: a\nrisks: none\n\n", ["files", "risks"]],
		["files: src/a.ts:12\nrisks: none", ["files", "risks"]],
		["files: a\nrisks: none\nmodel: e2e", ["files", "risks"]],
		["files : a", ["files"]],
		["files:\ta", ["files"]],
		["files:  a  ", ["files"]],
		["prefix\nfiles: a\nrisks: none\nnotes: n", ["files", "risks"]],
	];

	const rejects: Array<[string, string[]]> = [
		["files: a\nDone.", ["files"]],
		["**files**: a", ["files"]],
		["- files: a", ["files"]],
		["files = a", ["files"]],
		["files: a\n\nAll done.", ["files"]],
		["files: a\n```\nrisks: low\n```", ["files", "risks"]],
		["files:\nrisks: low", ["files"]],
		["files: a\nrisks were low", ["risks"]],
		["**Files:** a", ["files"]],
		["The files: a", ["files"]],
	];

	it("accepts a final contiguous block, ten ways", () => {
		for (const [text, fields] of accepts) {
			assert.deepEqual(missingReturn(text, fields), [], JSON.stringify(text));
		}
	});

	it("refuses loose mentions, bullets, bold and prose after the block, ten ways", () => {
		for (const [text, fields] of rejects) {
			assert.deepEqual(missingReturn(text, fields), fields, JSON.stringify(text));
		}
	});

	it("matches field names case-insensitively", () => {
		assert.deepEqual(missingReturn("FILES: a\nRisks: none", ["files", "risks"]), []);
	});

	it("does not count an incidental mention in prose", () => {
		const text = "The files matter here, and risks were considered.";
		assert.deepEqual(missingReturn(text, ["files", "risks"]), ["files", "risks"]);
	});

	it("does not count a mid-line label", () => {
		assert.deepEqual(missingReturn("see files: src/a.ts", ["files"]), ["files"]);
	});

	it("escapes regex characters in the field name", () => {
		assert.deepEqual(missingReturn("C++: n/a", ["C++"]), []);
		assert.deepEqual(missingReturn("C: n/a", ["C++"]), ["C++"]);
	});

	it("keeps the report and names what is missing", () => {
		const checked = checkReturn("files: a\n\nrisks were low.", ["files", "risks"]);
		assert.equal(checked.text, "files: a\n\nrisks were low.\n\n[return] missing: files, risks");
		assert.deepEqual(checked.missing, ["files", "risks"]);
		assert.equal(checked.failure, "verification");
	});

	it("leaves a complete report untouched", () => {
		const text = "files: a\nrisks: none";
		assert.deepEqual(checkReturn(text, ["files", "risks"]), { text, missing: [] });
	});

	it("treats an empty value as missing", () => {
		assert.deepEqual(missingReturn("files:\nrisks: none", ["files", "risks"]), ["files"]);
	});

	it("does nothing when no field was named", () => {
		assert.deepEqual(checkReturn("anything", []), { text: "anything", missing: [] });
	});
});

describe("return contract on Task", () => {
	const base = { description: "probe", prompt: "do it", subagent_type: "explorer" };

	it("passes the fields into a single-task plan", () => {
		const planned = planTask({ ...base, return: ["files", "risks"] } as never);
		assert.ok(planned.ok);
		if (planned.ok) assert.deepEqual(planned.plan.returnFields, ["files", "risks"]);
	});

	it("defaults to no contract", () => {
		const planned = planTask({ ...base } as never);
		assert.ok(planned.ok);
		if (planned.ok) assert.deepEqual(planned.plan.returnFields, []);
	});

	it("refuses malformed fields before anything starts", () => {
		const planned = planTask({ ...base, return: ["x".repeat(41)] } as never);
		assert.ok(!planned.ok);
		if (!planned.ok) {
			const first = planned.error.content[0];
			assert.equal(first?.type, "text");
			assert.match(first?.type === "text" ? first.text : "", /over 40 chars/);
		}
	});

	it("refuses a contract on chain and on parallel", () => {
		for (const call of [
			{ ...base, chain: ["explorer", "worker"], return: ["files"] },
			{ ...base, parallel: ["explorer", "worker"], return: ["files"] },
		]) {
			const planned = planTask(call as never);
			assert.ok(!planned.ok, JSON.stringify(call));
			if (!planned.ok) {
				const first = planned.error.content[0];
				assert.match(first?.type === "text" ? first.text : "", /return is single-task/);
			}
		}
	});

	it("allows a contract on a resume", () => {
		const planned = planTask({ ...base, resume: "task-1", return: ["next step"] } as never);
		assert.ok(planned.ok);
		if (planned.ok) assert.deepEqual(planned.plan.returnFields, ["next step"]);
	});
});
