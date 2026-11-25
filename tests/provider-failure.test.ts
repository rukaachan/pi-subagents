import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { providerFailure } from "../src/domain/run/index.ts";

const session = (messages: unknown[]) => ({ messages }) as never;

describe("provider failure", () => {
	it("returns the error message from an error-stop assistant turn", () => {
		assert.equal(
			providerFailure(
				session([
					{ role: "user", content: "hi" },
					{ role: "assistant", stopReason: "error", errorMessage: "content_filter" },
				]),
			),
			"content_filter",
		);
	});

	it("ignores a normal final answer and tool-use turns", () => {
		assert.equal(
			providerFailure(
				session([
					{ role: "assistant", stopReason: "toolUse" },
					{ role: "toolResult", content: [] },
					{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }] },
				]),
			),
			undefined,
		);
	});

	it("is empty when no assistant turn exists", () => {
		assert.equal(providerFailure(session([{ role: "user", content: "hi" }])), undefined);
	});
});
