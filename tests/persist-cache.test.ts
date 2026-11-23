/**
 * The state save measures each message once.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capRecord } from "../src/infra/state-file.ts";
import type { TaskRecord } from "../src/domain/task.ts";

describe("the message size cache", () => {
	it("measures each message once across saves", () => {
		const history = Array.from({ length: 3 }, (_, i) => ({
			role: "user",
			content: `message ${i}`,
		}));
		const record = { taskId: "task-1", history } as unknown as TaskRecord;
		const original = JSON.stringify;
		let calls = 0;
		JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
			calls += 1;
			return (original as (v: unknown, ...r: unknown[]) => string)(value, ...rest);
		}) as typeof JSON.stringify;
		try {
			capRecord(record);
			capRecord(record);
		} finally {
			JSON.stringify = original;
		}
		assert.equal(calls, 3);
	});
});
