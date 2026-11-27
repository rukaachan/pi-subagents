/**
 * The transcript screen: layout, scrolling, and the live tail.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { chat, screen, tagTheme, user } from "./session-fixture.ts";

const ESC = "\x1b";
const UP = "\x1b[A";
const DOWN = "\x1b[B";

describe("the session screen", () => {
	it("fills the screen exactly and never overflows the width", () => {
		const { view } = screen({ source: () => chat(30) });
		for (const width of [80, 44, 30]) {
			const out = view.render(width);
			assert.equal(out.length, 12, `height at ${width}`);
			for (const line of out)
				assert.ok(visibleWidth(line) <= width, `wide line at ${width}: ${line}`);
		}
	});

	it("shows the title, the stats, and the transcript body", () => {
		const out = screen().view.render(80);
		assert.match(out[0] ?? "", /worker · cur5e6/);
		assert.match(out[0] ?? "", /DONE/);
		assert.match(out[1] ?? "", /transcript/);
		assert.match(out[3] ?? "", /you/);
		assert.match(out[3] ?? "", /Task: map the rust engine/);
		assert.match(out.at(-1) ?? "", /esc back/);
	});

	it("colours each row by what it is", () => {
		const { view } = screen({
			theme: tagTheme() as never,
			source: () => [
				user("Task: go"),
				{
					role: "assistant",
					content: [{ type: "toolCall", name: "bash", arguments: { command: "ls" } }],
				},
				{
					role: "toolResult",
					toolName: "bash",
					isError: false,
					content: [{ type: "text", text: "ok" }],
				},
				{
					role: "toolResult",
					toolName: "bash",
					isError: true,
					content: [{ type: "text", text: "bad" }],
				},
			],
		});
		const all = view.render(84).join("\n");
		assert.match(all, /‹accent›you/);
		assert.match(all, /‹toolTitle›→ bash/);
		assert.match(all, /‹muted›← bash/);
		assert.match(all, /‹error›← bash/);
	});

	it("keeps the tail in view and follows new messages", () => {
		const messages: unknown[] = chat(20);
		const { view, pings } = screen({ source: () => messages, height: () => 10 });
		const first = view.render(70);
		assert.match(first[8] ?? "", /line 20/);
		messages.push(user("a brand new line"));
		const before = pings();
		view.sync();
		assert.ok(pings() > before, "asked for a repaint");
		assert.match(view.render(70)[8] ?? "", /a brand new line/);
	});

	it("stops following once you scroll up, and G brings it back", () => {
		const messages = chat(20);
		const { view } = screen({ source: () => messages, height: () => 10 });
		view.render(70);
		view.handleInput("k");
		const up = view.render(70);
		assert.match(up[8] ?? "", /line 19/, "one line up");
		messages.push(user("newest"));
		view.sync();
		assert.doesNotMatch(view.render(70)[8] ?? "", /newest/, "still reading history");
		view.handleInput("G");
		assert.match(view.render(70)[8] ?? "", /newest/, "back at the tail");
		view.handleInput("g");
		assert.match(view.render(70)[3] ?? "", /line 1/, "home shows the start");
		view.handleInput("\x1b[6~");
		assert.match(view.render(70)[3] ?? "", /line 7/, "page down");
		view.handleInput(DOWN);
		view.handleInput(UP);
	});

	it("previews long tool output and ctrl+o expands it", () => {
		const body = Array.from({ length: 30 }, (_, i) => `row ${i + 1}`).join("\n");
		const messages = [
			user("go"),
			{ role: "toolResult", toolName: "codemode", content: [{ type: "text", text: body }] },
		];
		const { view } = screen({ source: () => messages, height: () => 20 });
		const closed = view.render(80).join("\n");
		assert.match(closed, /row 10/);
		assert.doesNotMatch(closed, /row 11/);
		assert.match(closed, /20 more lines, ctrl\+o to expand/);
		view.handleInput("\x0f");
		const open = view.render(80).join("\n");
		assert.match(open, /row 30/);
		assert.doesNotMatch(open, /more lines/);
	});

	it("closes on escape and only once", () => {
		const { view, closes } = screen();
		view.handleInput(ESC);
		assert.equal(closes(), 1);
		view.dispose();
		assert.equal(closes(), 1, "dispose does not close again");
	});

	it("says so when there is nothing to show", () => {
		const out = screen({ source: () => [] }).view.render(60);
		assert.match(out[3] ?? "", /no transcript saved/);
	});

	it("repaints when only the stats change", () => {
		let stats = "RUNNING · 1t";
		const { view, pings } = screen({ source: () => [user("hi")], stats: () => stats });
		view.render(60);
		const before = pings();
		view.sync();
		assert.equal(pings(), before, "same stats, no repaint");
		stats = "RUNNING · 2t";
		view.sync();
		assert.ok(pings() > before, "new stats, repaint");
	});

	it("wraps only the new entry when a message arrives", () => {
		const messages = chat(20);
		let calls = 0;
		const theme = {
			fg: (_token: string, text: string) => {
				calls += 1;
				return text;
			},
			bold: (text: string) => text,
		};
		const { view } = screen({ source: () => messages, height: () => 10, theme: theme as never });
		view.render(70);
		const before = calls;
		messages.push(user("fresh"));
		view.sync();
		view.render(70);
		assert.ok(calls - before < 20, `rewrapped ${calls - before} rows`);
	});

	it("shows the in-flight text until the message ends", () => {
		const messages: unknown[] = [];
		let live: unknown = { role: "assistant", content: [{ type: "text", text: "thinking" }] };
		const { view } = screen({ source: () => messages, streaming: () => live });
		view.render(60);
		view.sync();
		assert.match(view.render(60).join("\n"), /thinking▍/);
		messages.push(live);
		live = undefined;
		view.sync();
		const out = view.render(60).join("\n");
		assert.match(out, /thinking/);
		assert.doesNotMatch(out, /▍/);
	});

	it("counts new messages while you read history", () => {
		const messages = chat(20);
		const { view } = screen({ source: () => messages, height: () => 10 });
		view.render(70);
		view.handleInput("k");
		messages.push(user("a"), user("b"));
		view.sync();
		assert.match(view.render(70).at(-1) ?? "", /↓2 new/);
		view.handleInput("G");
		assert.doesNotMatch(view.render(70).at(-1) ?? "", /new/);
	});

	it("unsubscribes on dispose", () => {
		let unsubs = 0;
		const { view } = screen({
			subscribe: () => () => {
				unsubs += 1;
			},
		});
		view.render(60);
		view.dispose();
		assert.equal(unsubs, 1);
	});

	it("goes quiet after dispose", () => {
		const { view, pings } = screen({ poll: true, alive: () => true });
		view.render(60);
		view.dispose();
		const before = pings();
		view.sync();
		assert.equal(pings(), before);
	});
});
