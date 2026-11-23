import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTransientFailure } from "../src/domain/run-result.ts";

describe("isTransientFailure", () => {
	it("accepts provider and network failures", () => {
		for (const message of [
			"429 Too Many Requests",
			"HTTP 503 Service Unavailable",
			"408 Request Timeout",
			"request timed out",
			"read ECONNRESET",
			"fetch failed",
			"socket hang up",
			"provider overloaded",
			"rate limit reached",
		]) {
			assert.equal(isTransientFailure(message), true, message);
		}
	});

	it("rejects a permanent failure", () => {
		for (const message of [
			"unknown model acme/nope",
			"invalid tools value",
			"the report mentions 4290 tokens",
			"401 Unauthorized",
			"prompt is too long",
		]) {
			assert.equal(isTransientFailure(message), false, message);
		}
	});
});
