/**
 * pi-subagents: the session viewer's 10-line preview and expansion.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { createSessionView } from "../src/ui/view/session/index.ts";

const LONG = Array.from({ length: 40 }, (_, i) => `LONG line ${i + 1}`).join("\n");

initTheme("dark", false);

const theme = { fg: (_token: string, text: string) => text, bold: (text: string) => text };

function viewer() {
	return createSessionView({
		title: "✓ e2e-long · cur5e6",
		stats: () => "DONE",
		source: () => [
			{ role: "user", content: "Task: E2E_LONG" },
			{
				role: "toolResult",
				toolName: "read",
				isError: false,
				content: [{ type: "text", text: LONG }],
			},
		],
		height: () => 52,
		theme: theme as never,
		empty: "",
		render: () => {},
		onClose: () => {},
	});
}

describe("viewer preview", () => {
	it("previews 40 result lines as 10, then expands with ctrl+o", () => {
		const view = viewer();
		const preview = view.render(100).join("\n");
		assert.equal(preview.match(/LONG line/g)?.length, 10);
		assert.match(preview, /\(30 more lines, ctrl\+o to expand\)/);
		assert.doesNotMatch(preview, /LONG line 11/);

		view.handleInput("\x0f");
		const expanded = view.render(100).join("\n");
		assert.equal(expanded.match(/LONG line/g)?.length, 40);
		assert.doesNotMatch(expanded, /more lines, ctrl\+o/);
	});
});
