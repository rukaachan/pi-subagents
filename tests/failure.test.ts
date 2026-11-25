import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { failureHint, labelFailure, parseFailure } from "../src/domain/policy/index.ts";
import { foldJournal } from "../src/telemetry/journal/index.ts";

describe("failure families", () => {
	it("accepts the three names, case and space insensitive", () => {
		assert.equal(parseFailure("spec"), "spec");
		assert.equal(parseFailure(" Coordination "), "coordination");
		assert.equal(parseFailure("VERIFICATION"), "verification");
	});

	it("rejects anything else", () => {
		assert.equal(parseFailure("billing"), "bad");
		assert.equal(parseFailure(3), "bad");
		assert.equal(parseFailure(undefined), undefined);
	});

	it("hints at the only write path", () => {
		assert.match(failureHint(), /TaskOutput\(task_id, failure: spec\|coordination\|verification\)/);
	});
});

describe("labelFailure", () => {
	it("sets a family on a finished run", () => {
		assert.deepEqual(labelFailure("done", undefined, "spec"), { kind: "set", family: "spec" });
		assert.deepEqual(labelFailure("error", undefined, "verification"), {
			kind: "set",
			family: "verification",
		});
	});

	it("refuses a running run", () => {
		assert.deepEqual(labelFailure("running", undefined, "spec"), { kind: "running" });
	});

	it("keeps the first label", () => {
		assert.deepEqual(labelFailure("error", "spec", "verification"), {
			kind: "kept",
			family: "spec",
		});
	});

	it("reports a bad value, and ignores an absent one", () => {
		assert.deepEqual(labelFailure("error", undefined, "nope"), { kind: "bad", value: "nope" });
		assert.equal(labelFailure("error", undefined, undefined), undefined);
	});
});

describe("journal fold", () => {
	it("carries the failure event onto the run", () => {
		const lines = [
			JSON.stringify({ event: "run_start", id: "t1", label: "explorer", kind: "background" }),
			JSON.stringify({ event: "run_end", id: "t1", status: "error", turns: 1, elapsedSec: 2 }),
			JSON.stringify({ event: "failure", id: "t1", family: "coordination" }),
		];
		const run = foldJournal(lines).find((r) => r.id === "t1");
		assert.equal(run?.status, "error");
		assert.equal(run?.failure, "coordination");
	});

	it("ignores an unknown family and a missing run", () => {
		const lines = [
			JSON.stringify({ event: "run_start", id: "t1", label: "x", kind: "background" }),
			JSON.stringify({ event: "failure", id: "t1", family: "billing" }),
			JSON.stringify({ event: "failure", id: "ghost", family: "spec" }),
		];
		const runs = foldJournal(lines);
		assert.equal(runs[0]?.failure, undefined);
		assert.equal(runs.length, 1);
	});
});
