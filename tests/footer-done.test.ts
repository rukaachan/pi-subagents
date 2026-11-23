import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DONE_TTL_MS, FooterProgress } from "../src/telemetry/progress.ts";

function clock(start = 0) {
	let t = start;
	return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("footer done tokens", () => {
	it("shows a check and the elapsed seconds", () => {
		const c = clock();
		const p = new FooterProgress({ now: c.now });
		p.start("a", "explorer");
		c.advance(2000);
		p.finish("a", { status: "done" });
		assert.equal(p.render(), "✓ explorer 2s");
		p.clearDone();
	});

	it("marks an error and an interrupted run", () => {
		const c = clock();
		const p = new FooterProgress({ now: c.now });
		p.start("e", "worker");
		p.finish("e", { status: "error" });
		p.start("s", "tester");
		p.finish("s", { status: "interrupted" });
		const line = p.render() ?? "";
		assert.match(line, /^⊘ tester 0s · ✗ worker 0s$/);
		p.clearDone();
	});

	it("keeps a finished leg only for the TTL", () => {
		const c = clock();
		const p = new FooterProgress({ now: c.now });
		p.start("a", "explorer");
		p.finish("a", { status: "done" });
		assert.ok(p.render(DONE_TTL_MS - 1));
		assert.equal(p.render(DONE_TTL_MS), undefined);
		p.clearDone();
	});

	it("shows the newest three and counts the rest", () => {
		const c = clock();
		const p = new FooterProgress({ now: c.now });
		for (const key of ["a", "b", "c", "d"]) {
			p.start(key, key);
			p.finish(key, { status: "done" });
		}
		const line = p.render() ?? "";
		assert.match(line, /^✓ d 0s · ✓ c 0s · ✓ b 0s \+1$/);
		p.clearDone();
	});

	it("puts finishes before the live line", () => {
		const c = clock();
		const p = new FooterProgress({ now: c.now });
		p.start("live", "worker");
		p.start("done", "explorer");
		p.finish("done", { status: "done" });
		const line = p.render() ?? "";
		assert.match(line, /^✓ explorer 0s · ⇄/);
		assert.match(line, /worker/);
		p.clearDone();
	});

	it("keeps the overflow count when it has to clip", () => {
		const c = clock();
		const p = new FooterProgress({ now: c.now });
		for (let i = 0; i < 6; i++) {
			p.start(`k${i}`, `code-reviewer-extra-long-${i}`);
			p.finish(`k${i}`, { status: "done" });
		}
		const line = p.render() ?? "";
		assert.ok(line.length <= 64, line);
		assert.match(line, /\+\d+$/, line);
		p.clearDone();
	});

	it("never goes over 64 characters", () => {
		const c = clock();
		const p = new FooterProgress({ now: c.now });
		for (let i = 0; i < 4; i++) {
			p.start(`k${i}`, `a-very-long-subagent-name-${i}`);
			p.finish(`k${i}`, { status: "done" });
		}
		p.start("live", "another-extremely-long-label");
		assert.ok((p.render() ?? "").length <= 64);
		p.clearDone();
	});

	it("adds one token when finish runs twice", () => {
		const c = clock();
		const p = new FooterProgress({ now: c.now });
		p.start("a", "explorer");
		p.finish("a", { status: "done" });
		p.finish("a", { status: "done" });
		assert.equal((p.render() ?? "").split("✓").length - 1, 1);
		p.clearDone();
	});

	it("ignores a key that never started", () => {
		const c = clock();
		const p = new FooterProgress({ now: c.now });
		assert.doesNotThrow(() => p.finish("ghost", { status: "error" }));
		assert.equal(p.render(), undefined);
		p.clearDone();
	});

	it("shows legs that wait for a slot", () => {
		const c = clock();
		const p = new FooterProgress({ now: c.now });
		p.setWaiting(2);
		assert.equal(p.render(), "⇄ 2 queued");
		p.start("live", "explorer");
		assert.match(p.render() ?? "", /explorer/);
		assert.match(p.render() ?? "", /2 queued/);
		p.setWaiting(0);
		assert.match(p.render() ?? "", /explorer/);
		p.finish("live", { status: "done" });
		p.clearDone();
	});

	it("clears the line on demand", () => {
		const c = clock();
		const p = new FooterProgress({ now: c.now });
		p.start("a", "explorer");
		p.finish("a", { status: "done" });
		p.clearDone();
		assert.equal(p.render(), undefined);
	});
});
