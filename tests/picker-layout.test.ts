/**
 * How the picker lays a row out, and how a description is fitted.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSelectListTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { SelectList } from "@earendil-works/pi-tui";
import { descriptionWidth, fitDescriptions } from "../src/ui/picker-render.ts";
import { type PickItem } from "../src/ui/picker-types.ts";

const SUBAGENTS: PickItem[] = [
	{ value: "code-reviewer", label: "code-reviewer", description: "read-only ◇ — Review diffs" },
	{ value: "explorer", label: "explorer", description: "read-only ◇ — Fast search" },
	{ value: "tester", label: "tester", description: "execute ◇ — Prove a fix" },
	{ value: "worker", label: "worker", description: "all ◇ — Multi-step edits" },
];
initTheme("dark", false);
describe("SelectList layout", () => {
	it("renders one line per item", () => {
		const list = new SelectList(SUBAGENTS, 12, getSelectListTheme());
		const lines = list.render(78);
		assert.equal(lines.length, SUBAGENTS.length);
	});

	it("keeps a long row on one line at a narrow width", () => {
		const items: PickItem[] = [
			{
				value: "a",
				label: "code-reviewer",
				description:
					"read-only ◇ — Review diffs and code for bugs, safety, and scope. Use after edits.",
			},
		];
		const list = new SelectList(items, 12, getSelectListTheme());
		assert.equal(list.render(40).length, 1);
		assert.equal(list.render(20).length, 1);
	});

	it("bounds visible rows and shows a scroll counter", () => {
		const items: PickItem[] = Array.from({ length: 20 }, (_, i) => ({
			value: `v${i}`,
			label: `item-${i}`,
		}));
		const list = new SelectList(items, 5, getSelectListTheme());
		const lines = list.render(60);
		assert.ok(lines.length <= 6, `5 rows + counter, got ${lines.length}`);
		assert.ok(
			lines.some((l) => l.includes("1/20")),
			"shows the scroll position",
		);
	});

	it("drops the description column when width is too small", () => {
		const list = new SelectList(SUBAGENTS, 12, getSelectListTheme());
		const lines = list.render(20);
		assert.equal(lines.length, SUBAGENTS.length);
		for (const line of lines) {
			assert.ok(line.length < 60, "line stays short");
		}
	});
});
describe("description fitting", () => {
	const long = "Fast codebase search and structure questions. Use for where-is and how-does.";

	it("gives the description a positive width at normal sizes", () => {
		assert.ok(descriptionWidth(["explorer"], 78) > 30);
		assert.ok(descriptionWidth(["explorer"], 100) > 50);
	});

	it("gives no description column on a narrow terminal", () => {
		assert.equal(descriptionWidth(["explorer"], 38), 0);
		assert.equal(descriptionWidth(["explorer"], 20), 0);
	});

	it("ends a too-long description with an ellipsis", () => {
		const items: PickItem[] = [{ value: "a", label: "explorer", description: long }];
		const [item] = items;
		assert.ok(item, "item exists");
		fitDescriptions(items, 60);
		assert.notEqual(item.description, long, "was shortened");
		assert.ok(item.description?.endsWith("…"), `got ${item.description}`);
	});

	it("keeps a short description unchanged", () => {
		const items: PickItem[] = [{ value: "a", label: "explorer", description: "Short one." }];
		const [item] = items;
		assert.ok(item, "item exists");
		fitDescriptions(items, 100);
		assert.equal(item.description, "Short one.");
	});

	it("restores the full text when the terminal widens", () => {
		const items: PickItem[] = [{ value: "a", label: "explorer", description: long }];
		const [item] = items;
		assert.ok(item, "item exists");
		fitDescriptions(items, 60);
		assert.ok(item.description?.endsWith("…"));
		fitDescriptions(items, 200);
		assert.equal(item.description, long, "original text comes back");
	});

	it("drops the description when there is no room", () => {
		const items: PickItem[] = [{ value: "a", label: "explorer", description: long }];
		const [item] = items;
		assert.ok(item, "item exists");
		fitDescriptions(items, 20);
		assert.equal(item.description, undefined);
	});

	it("brings the description back after a narrow render", () => {
		const items: PickItem[] = [{ value: "a", label: "explorer", description: long }];
		const [item] = items;
		assert.ok(item, "item exists");
		fitDescriptions(items, 20);
		fitDescriptions(items, 100);
		assert.ok(
			(item.description ?? "").length > 0,
			"a resize back to a wide terminal restores the text",
		);
	});
});
