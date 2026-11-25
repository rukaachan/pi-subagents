import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { installRunBudget } from "../src/app/guards/index.ts";
import type { BudgetClock } from "../src/app/guards/index.ts";
import { parseBudget } from "../src/domain/subagent/index.ts";

const clock: BudgetClock = { now: () => 0, schedule: () => () => {} };

type Listener = (event: {
	type: string;
	message?: { usage?: { cost?: { total?: number } } };
}) => void;

function session() {
	let listener: Listener | null = null;
	let aborted = false;
	return {
		subscribe(fn: Listener) {
			listener = fn;
			return () => {
				listener = null;
			};
		},
		abort() {
			aborted = true;
		},
		emit(cost: number) {
			listener?.({ type: "turn_end", message: { usage: { cost: { total: cost } } } });
		},
		get aborted() {
			return aborted;
		},
	};
}

describe("the cost budget", () => {
	it("trips when the provider-reported cost reaches the cap", () => {
		const child = session();
		const stop = installRunBudget(child, { maxCost: 10 }, clock);
		child.emit(12);
		assert.equal(stop.spent(), true);
		assert.match(stop.note() ?? "", /cost budget \$10 reached/);
		assert.equal(child.aborted, true);
		stop.dispose();
	});

	it("stays idle and says so when the provider reports no cost", () => {
		const child = session();
		const stop = installRunBudget(child, { maxCost: 10 }, clock);
		child.emit(0);
		assert.equal(stop.spent(), false);
		assert.match(stop.note() ?? "", /reported no cost/);
		assert.equal(child.aborted, false);
		stop.dispose();
	});

	it("accepts a fractional cost cap", () => {
		assert.deepEqual(parseBudget({ maxCost: 0.5 }), { maxCost: 0.5 });
		assert.match(String(parseBudget({ maxCost: -1 })), /non-negative number/);
	});
});
