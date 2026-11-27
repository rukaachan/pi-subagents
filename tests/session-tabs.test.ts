/**
 * The viewer tabs: filter, jump to an error, and copy.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSessionView } from "../src/ui/view/session/index.ts";

function plainTheme() {
	return { fg: (_token: string, text: string) => text, bold: (text: string) => text };
}

function user(text: string) {
	return { role: "user", content: text };
}

const toolCall = {
	role: "assistant",
	content: [{ type: "toolCall", name: "bash", arguments: { command: "ls" } }],
};
const failed = {
	role: "toolResult",
	toolName: "bash",
	isError: true,
	content: [{ type: "text", text: "boom" }],
};
const done = { role: "assistant", content: [{ type: "text", text: "done" }] };

function view(messages: readonly unknown[], over: Record<string, unknown> = {}) {
	return createSessionView({
		title: "worker",
		stats: () => "RUNNING",
		source: () => messages,
		height: () => 12,
		theme: plainTheme() as never,
		empty: "(none)",
		render: () => {},
		onClose: () => {},
		...over,
	});
}

describe("the viewer tabs", () => {
	it("filters the transcript with 1, 2, and 3", () => {
		const v = view([user("go"), toolCall, failed, done]);
		assert.match(v.render(80).join("\n"), /you\s+go/);
		v.handleInput("2");
		const tools = v.render(80).join("\n");
		assert.match(tools, /→ bash/);
		assert.doesNotMatch(tools, /you\s+go/);
		v.handleInput("3");
		const errors = v.render(80).join("\n");
		assert.match(errors, /boom/);
		assert.doesNotMatch(errors, /→ bash/);
		v.handleInput("1");
		assert.match(v.render(80).join("\n"), /you\s+go/);
	});

	it("prints the count for each tab", () => {
		const bar = view([user("go"), toolCall, failed, done]).render(80)[1] ?? "";
		assert.match(bar, /1 transcript 4/);
		assert.match(bar, /2 tools 1/);
		assert.match(bar, /3 errors 1/);
	});

	it("jumps to the next error with e", () => {
		const messages = [
			...Array.from({ length: 20 }, (_, i) => user(`row ${i + 1}`)),
			toolCall,
			failed,
			...Array.from({ length: 10 }, (_, i) => user(`after ${i + 1}`)),
		];
		const v = view(messages);
		assert.doesNotMatch(v.render(80).join("\n"), /boom/);
		v.handleInput("e");
		assert.match(v.render(80).join("\n"), /boom/);
	});

	it("falls back to the errors tab when there are none", () => {
		const v = view([user("go"), done]);
		v.handleInput("e");
		assert.match(v.render(80).join("\n"), /\(none\)/);
	});

	it("copies the visible tab with y", () => {
		let copied = "";
		const v = view([user("go"), toolCall, failed, done], {
			onCopy: (text: string) => {
				copied = text;
			},
		});
		v.render(80);
		v.handleInput("y");
		assert.match(copied, /you\s+go/);
		assert.match(copied, /→ bash/);
		v.handleInput("3");
		v.handleInput("y");
		assert.match(copied, /← bash\s+boom/);
		assert.doesNotMatch(copied, /you\s+go/);
	});
});
