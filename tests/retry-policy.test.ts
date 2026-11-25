import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RetryPolicy, retryAfterMs, sleepUnlessStopped } from "../src/app/retry/index.ts";

function policy(random = 0.5, now = () => 0): RetryPolicy {
	return new RetryPolicy({ now, random: () => random });
}

describe("retry delay policy", () => {
	it("jitters 1s and 4s by ±25%", () => {
		assert.equal(policy(0).delayFor(1, "503", "m").delayMs, 750);
		assert.equal(policy(1).delayFor(1, "503", "m").delayMs, 1250);
		assert.equal(policy(0).delayFor(2, "503", "m").delayMs, 3000);
		assert.equal(policy(1).delayFor(2, "503", "m").delayMs, 5000);
		assert.equal(policy(0.5).delayFor(3, "503", "m").delayMs, 4000);
	});

	it("reads Retry-After seconds and uses the larger delay", () => {
		const plan = policy(0).delayFor(1, "429 Too Many Requests\nRetry-After: 7", "m");
		assert.deepEqual(plan, { delayMs: 7000, reason: "header" });
	});

	it("reads an HTTP-date Retry-After", () => {
		const now = 1_700_000_000_000;
		const date = new Date(now + 12_000).toUTCString();
		assert.equal(retryAfterMs(`429\nRetry-After: ${date}`, now), 12_000);
		assert.equal(
			policy(0.5, () => now).delayFor(1, `429 Retry-After: ${date}`, "m").delayMs,
			12_000,
		);
	});

	it("caps a long header at 30s", () => {
		assert.equal(policy(0.5).delayFor(1, "429 Retry-After: 99", "m").delayMs, 30_000);
	});

	it("shares a per-model cooldown after a 429", () => {
		let now = 1000;
		const p = policy(0.5, () => now);
		const first = p.delayFor(1, "429 Too Many Requests\nRetry-After: 2", "same");
		assert.equal(first.delayMs, 2000);
		now += 500;
		const peer = p.delayFor(1, "503 Service Unavailable", "same");
		assert.deepEqual(peer, { delayMs: 1500, reason: "cooldown" });
		now += 2000;
		assert.deepEqual(p.delayFor(1, "503 Service Unavailable", "same"), {
			delayMs: 1000,
			reason: "jitter",
		});
	});

	it("ignores a bad header and clears cooldowns", () => {
		assert.equal(retryAfterMs("503 no header", 0), undefined);
		assert.equal(retryAfterMs("429 Retry-After: not-a-date", 0), undefined);
		let now = 1000;
		const p = policy(0.5, () => now);
		p.delayFor(1, "429 Retry-After: 2", "m");
		p.clear();
		now += 500;
		assert.deepEqual(p.delayFor(1, "503", "m"), { delayMs: 1000, reason: "jitter" });
	});

	it("does not cooldown a different model", () => {
		let now = 1000;
		const p = policy(0.5, () => now);
		p.delayFor(1, "429 Retry-After: 2", "a");
		now += 500;
		assert.deepEqual(p.delayFor(1, "503", "b"), { delayMs: 1000, reason: "jitter" });
	});
});

describe("stop-aware retry sleep", () => {
	it("returns false at once when the run is already stopped", async () => {
		const started = Date.now();
		assert.equal(await sleepUnlessStopped(1000, () => true), false);
		assert.ok(Date.now() - started < 200);
	});

	it("stops during a long wait instead of waiting it out", async () => {
		let stop = false;
		const timer = setTimeout(() => {
			stop = true;
		}, 30);
		const started = Date.now();
		assert.equal(await sleepUnlessStopped(1000, () => stop, 20), false);
		assert.ok(Date.now() - started < 500);
		clearTimeout(timer);
	});

	it("returns true after the full wait when nobody stops", async () => {
		const started = Date.now();
		assert.equal(await sleepUnlessStopped(40, () => false, 10), true);
		assert.ok(Date.now() - started >= 35);
	});

	it("settles in a bare process where no other handle keeps the loop alive", () => {
		const module = fileURLToPath(new URL("../src/app/retry/retry-policy.ts", import.meta.url));
		const script = `import { sleepUnlessStopped } from "${module}";
const ok = await sleepUnlessStopped(40, () => false, 10);
console.log("RESULT", ok);`;
		const out = execFileSync(
			process.execPath,
			["--experimental-strip-types", "--input-type=module", "-e", script],
			{ encoding: "utf8" },
		);
		assert.match(out, /RESULT true/);
	});
});
