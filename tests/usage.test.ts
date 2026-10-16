import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sumUsage } from "../src/domain/run-result.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

// sumUsage reads the AgentMessage union from Pi.
const assistant = (usage: AgentMessage["role"] extends never ? never : object) =>
	({ role: "assistant", usage }) as AgentMessage;

const user = (text: string) => ({ role: "user", content: text, timestamp: 0 }) as AgentMessage;

const toolResult = (usage: object) =>
	({
		role: "toolResult",
		toolCallId: "t1",
		toolName: "read",
		usage,
		content: [],
		isError: false,
		timestamp: 0,
	}) as AgentMessage;

describe("sumUsage", () => {
	it("sums assistant messages only", () => {
		const out = sumUsage([
			assistant({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } }),
			assistant({ input: 20, output: 8, cacheRead: 2, cacheWrite: 1, cost: { total: 0.02 } }),
		]);
		assert.deepEqual(out, {
			input: 30,
			output: 13,
			cacheRead: 2,
			cacheWrite: 1,
			cost: 0.03,
			turns: 2,
		});
	});

	it("skips user and toolResult messages", () => {
		const out = sumUsage([
			user("hello"),
			toolResult({ input: 99, output: 99, cacheRead: 0, cacheWrite: 0, cost: { total: 9 } }),
		]);
		assert.deepEqual(out, {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			turns: 0,
		});
	});

	it("returns the zero total for an empty session", () => {
		assert.deepEqual(sumUsage([]), {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			turns: 0,
		});
	});

	it("treats missing fields as zero", () => {
		const out = sumUsage([assistant({})]);
		assert.deepEqual(out, {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			turns: 1,
		});
	});
});
