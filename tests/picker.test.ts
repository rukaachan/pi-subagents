/**
 * The picker: one line per item, one answer back.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { pickFromList } from "../src/ui/picker.ts";
import { type PickHost, type PickItem } from "../src/ui/picker-types.ts";

const SUBAGENTS: PickItem[] = [
	{ value: "code-reviewer", label: "code-reviewer", description: "read-only ◇ — Review diffs" },
	{ value: "explorer", label: "explorer", description: "read-only ◇ — Fast search" },
	{ value: "tester", label: "tester", description: "execute ◇ — Prove a fix" },
	{ value: "worker", label: "worker", description: "all ◇ — Multi-step edits" },
];
function fakeHost(answer: {
	keys?: string[];
	selectAnswer?: string;
	customThrows?: boolean;
	noCustom?: boolean;
}): PickHost & { calls: string[] } {
	const ui: Record<string, unknown> = {};
	const calls: string[] = [];

	const custom = async <T>(
		factory: (
			tui: { requestRender(): void },
			theme: never,
			kb: never,
			done: (r: T) => void,
		) => { render(width: number): string[]; handleInput?(d: string): void },
	): Promise<T> => {
		calls.push("custom");
		if (answer.customThrows) throw new Error("custom unavailable");
		let result: T | undefined;
		const comp = factory({ requestRender: () => {} }, stubTheme, null as never, (r) => {
			result = r;
		});
		for (const k of answer.keys ?? []) {
			if (result !== undefined) break;
			comp.handleInput?.(k);
		}
		return result as T;
	};

	const select = async (_t: string, options: string[]): Promise<string | undefined> => {
		calls.push("select");
		if (answer.selectAnswer === undefined) return undefined;
		return options.includes(answer.selectAnswer) ? answer.selectAnswer : options[0];
	};

	if (!answer.noCustom) ui.custom = custom as never;
	if (answer.selectAnswer !== undefined) ui.select = select as never;

	return { calls, ui } as unknown as PickHost & { calls: string[] };
}
const ENTER = "\r";
const ESC = "\x1b";
const DOWN = "\x1b[B";
const stubTheme = {
	fg: (_token: string, text: string) => text,
	bold: (text: string) => text,
} as never;
initTheme("dark", false);
describe("pickFromList", () => {
	it("returns the first item on enter", async () => {
		const h = fakeHost({ keys: [ENTER] });
		const out = await pickFromList(h, { title: "Subagents", items: SUBAGENTS });
		assert.equal(out, "code-reviewer");
		assert.ok(h.calls.includes("custom"), "used the custom picker");
	});

	it("moves with the down arrow and j", async () => {
		assert.equal(
			await pickFromList(fakeHost({ keys: [DOWN, ENTER] }), { title: "t", items: SUBAGENTS }),
			"explorer",
		);
		assert.equal(
			await pickFromList(fakeHost({ keys: ["j", "j", ENTER] }), { title: "t", items: SUBAGENTS }),
			"tester",
		);
		assert.equal(
			await pickFromList(fakeHost({ keys: ["j", "\x1b[A", ENTER] }), {
				title: "t",
				items: SUBAGENTS,
			}),
			"code-reviewer",
		);
	});

	it("returns undefined on escape and does not re-prompt", async () => {
		// Regression: the old custom-overlay path fell through to
		// host.ui.select after a cancel, so escape showed a second
		// bare list that ate another Esc. A cancel is final.
		const h = fakeHost({ keys: [ESC], selectAnswer: "worker" });
		const out = await pickFromList(h, { title: "t", items: SUBAGENTS });
		assert.equal(out, undefined);
		assert.ok(!h.calls.includes("select"), `second prompt shown: ${h.calls.join(",")}`);
	});

	it("returns undefined when the list is empty", async () => {
		const h = fakeHost({ keys: [ENTER] });
		const out = await pickFromList(h, { title: "t", items: [] });
		assert.equal(out, undefined);
		assert.deepEqual(h.calls, [], "no UI shown for an empty list");
	});

	it("falls back to select and maps the label back to its value", async () => {
		const h = fakeHost({ noCustom: true, selectAnswer: "tester" });
		const out = await pickFromList(h, { title: "t", items: SUBAGENTS });
		assert.deepEqual(h.calls, ["select"]);
		assert.equal(out, "tester");
	});

	it("falls back when custom throws", async () => {
		const h = fakeHost({ customThrows: true, selectAnswer: "worker" });
		const out = await pickFromList(h, { title: "t", items: SUBAGENTS });
		assert.ok(h.calls.includes("custom"));
		assert.ok(h.calls.includes("select"));
		assert.equal(out, "worker");
	});

	it("keeps values distinct from labels on the fallback path", async () => {
		// Two items share a label; the first match wins and must not throw.
		const items: PickItem[] = [
			{ value: "\u0000tasks", label: "Tasks" },
			{ value: "worker", label: "worker" },
		];
		const out = await pickFromList(fakeHost({ noCustom: true, selectAnswer: "worker" }), {
			title: "t",
			items,
		});
		assert.equal(out, "worker");
	});
});
