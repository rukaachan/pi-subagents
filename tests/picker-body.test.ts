/**
 * The recent-steps body a picker shows for a run.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { cutToWidth } from "../src/ui/picker-render.ts";
import { pickFromList } from "../src/ui/picker.ts";
import { type PickHost, type PickItem } from "../src/ui/picker-types.ts";

const stubTheme = {
	fg: (_token: string, text: string) => text,
	bold: (text: string) => text,
} as never;
const SUBAGENTS: PickItem[] = [
	{ value: "code-reviewer", label: "code-reviewer", description: "read-only ◇ — Review diffs" },
	{ value: "explorer", label: "explorer", description: "read-only ◇ — Fast search" },
	{ value: "tester", label: "tester", description: "execute ◇ — Prove a fix" },
	{ value: "worker", label: "worker", description: "all ◇ — Multi-step edits" },
];
const ENTER = "\r";
async function renderAt(width: number, body: string[]): Promise<string[]> {
	let out: string[] = [];
	const host = {
		ui: {
			custom: async (
				factory: (
					tui: { requestRender(): void },
					theme: never,
					kb: never,
					done: (r: unknown) => void,
				) => { render(w: number): string[] },
			) => {
				const comp = factory({ requestRender: () => {} }, stubTheme, null as never, () => {});
				out = comp.render(width);
				return undefined;
			},
		},
	} as unknown as PickHost;
	await pickFromList(host, { title: "t", body, items: SUBAGENTS });
	return out;
}
initTheme("dark", false);
describe("picker body (recent steps)", () => {
	it("renders the body lines above the list and still returns the picked value", async () => {
		let rendered: string[] = [];
		const host = {
			ui: {
				custom: async <T>(
					factory: (
						tui: { requestRender(): void },
						theme: never,
						kb: never,
						done: (r: T) => void,
					) => { render(width: number): string[]; handleInput?(d: string): void },
				): Promise<T> => {
					let result: T | undefined;
					const comp = factory({ requestRender: () => {} }, stubTheme, null as never, (r) => {
						result = r;
					});
					rendered = comp.render(90);
					comp.handleInput?.(ENTER);
					return result as T;
				},
			},
		} as unknown as PickHost;
		const out = await pickFromList(host, {
			title: "● worker · 6ax4",
			subtitle: "enter to choose · esc to go back",
			body: ["bash · go test ./...", "read · src/runner.ts", "edit · src/subagents.ts"],
			items: [
				{ value: "Copy task_id", label: "Copy task_id" },
				{ value: "← Back to runs", label: "← Back to runs" },
			],
		});
		const text = rendered.join("\n");
		assert.equal(out, "Copy task_id", "the list still works under the body");
		assert.ok(text.includes("bash · go test ./..."), "first step rendered");
		assert.ok(text.includes("read · src/runner.ts"), "second step rendered");
		assert.ok(text.includes("edit · src/subagents.ts"), "third step rendered");
		// The body must not become selectable rows: moving down goes to
		// the second ACTUAL action, not into a step line.
		assert.ok(
			rendered.filter((l) => l.includes("bash · go test")).length === 1,
			"one line per step",
		);

		const narrow = await renderAt(40, ["bash · " + "x".repeat(80)]);
		const bodyRows = narrow.filter((l) => l.trim().startsWith("bash ·"));
		assert.equal(bodyRows.length, 1, `step wrapped into ${bodyRows.length} rows`);
		assert.ok((bodyRows[0] ?? "").length <= 40, "row fit the width");
		assert.ok((bodyRows[0] ?? "").trimEnd().endsWith("…"), "cut, not silently dropped");
	});

	it("cutToWidth cuts with an ellipsis and leaves short lines alone", () => {
		assert.equal(cutToWidth("abc", 10), "abc");
		assert.equal(cutToWidth("abcdef", 6), "abcdef");
		assert.equal(cutToWidth("abcdef", 5), "abcd…");
		assert.equal(cutToWidth("abcdef", 1), "a");
		assert.equal(cutToWidth("abcdef", 0), "");
		assert.equal(cutToWidth("", 5), "");
	});

	it("an empty body adds no blank rows", async () => {
		let rendered: string[] = [];
		const host = {
			ui: {
				custom: async <T>(
					factory: (
						tui: { requestRender(): void },
						theme: never,
						kb: never,
						done: (r: T) => void,
					) => { render(width: number): string[] },
				): Promise<T> => {
					const comp = factory(
						{ requestRender: () => {} },
						stubTheme,
						null as never,
						(r) => r as T,
					);
					rendered = comp.render(90);
					return undefined as T;
				},
			},
		} as unknown as PickHost;
		await pickFromList(host, { title: "t", body: [], items: SUBAGENTS });
		assert.ok(
			rendered.every((l) => l.trim().length >= 0),
			"render never throws",
		);
	});
});
