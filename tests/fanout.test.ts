import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fanoutAdmission } from "../src/domain/dispatch.ts";

describe("fan-out admission (closing silent leg loss)", () => {
	it("accepts up to the live cap", () => {
		assert.deepEqual(fanoutAdmission(1, 12), { ok: true });
		assert.deepEqual(fanoutAdmission(8, 12), { ok: true });
		assert.deepEqual(fanoutAdmission(12, 12), { ok: true });
	});

	it("refuses more legs than the cap, with a batching instruction", () => {
		const verdict = fanoutAdmission(13, 12);
		assert.equal(verdict.ok, false);
		if (!verdict.ok) {
			assert.match(verdict.reason, /refused: 13 legs against a live cap of 12/);
			assert.match(verdict.reason, /batch/);
		}
	});

	it("refuses nonsense counts", () => {
		assert.equal(fanoutAdmission(0, 12).ok, false);
		assert.equal(fanoutAdmission(-2, 12).ok, false);
		assert.equal(fanoutAdmission(2.5, 12).ok, false);
		assert.equal(fanoutAdmission(Number.NaN, 12).ok, false);
	});

	it("records the defect it closes: no fake queued ids", async () => {
		// The fan-out driver lives in src/app/fanout.ts; the invariant follows it.
		const text = await (
			await import("node:fs/promises")
		).readFile(new URL("../src/app/fanout.ts", import.meta.url), "utf8");
		assert.doesNotMatch(text, /\(queued, cap/, "the fake queued id is gone");
		assert.match(text, /notStarted\.push/, "non-started legs are named, not faked");
		assert.match(text, /fanoutAdmission\(names\.length/, "the cap check runs before any launch");
	});
});
