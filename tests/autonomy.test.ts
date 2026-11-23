import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	TOOL_GROUPS,
	clampToolsForAutonomy,
	type SubagentConfig,
} from "../src/domain/subagent/config.ts";

function sub(over: Partial<SubagentConfig>): SubagentConfig {
	return {
		name: "probe",
		description: "",
		model: "inherit",
		autonomy: "inherit",
		systemPrompt: "p",
		source: "user",
		filePath: "probe.md",
		warnings: [],
		...over,
	};
}

const READ_ONLY = TOOL_GROUPS["read-only"] ?? [];

describe("autonomy clamp is a policy", () => {
	it("off and low keep only the read-only group", () => {
		for (const autonomy of ["off", "low"] as const) {
			const r = clampToolsForAutonomy(
				sub({ autonomy, tools: ["read", "bash", "edit", "write", "grep"] }),
			);
			assert.deepEqual(r.tools, ["read", "grep"], autonomy);
			assert.match(r.notes.join(" "), /read-only/, autonomy);
		}
	});

	it("low with no list gets exactly the read-only group", () => {
		const r = clampToolsForAutonomy(sub({ autonomy: "low", tools: undefined }));
		assert.deepEqual(r.tools, READ_ONLY);
		assert.match(r.notes.join(" "), /read-only/);
	});

	it("low strips codemode and MCP tools even if a file names them", () => {
		const r = clampToolsForAutonomy(
			sub({
				autonomy: "low",
				tools: ["read", "codemode", "mcp__echo__echo"],
			}),
		);
		assert.deepEqual(r.tools, ["read"]);
		assert.match(r.notes.join(" "), /read-only/);
	});

	it("medium removes shell and keeps writes", () => {
		const r = clampToolsForAutonomy(
			sub({ autonomy: "medium", tools: ["read", "edit", "bash", "powershell", "write"] }),
		);
		assert.deepEqual(r.tools, ["read", "edit", "write"]);
		assert.match(r.notes.join(" "), /shell is off/);
	});

	it("medium with no list starts from the edit group, without shell", () => {
		const r = clampToolsForAutonomy(sub({ autonomy: "medium", tools: undefined }));
		assert.deepEqual(r.tools, TOOL_GROUPS.edit);
		assert.ok(!r.tools?.includes("bash"));
	});

	it("medium with only shell falls back to read-only instead of no tools", () => {
		const r = clampToolsForAutonomy(sub({ autonomy: "medium", tools: ["bash"] }));
		assert.deepEqual(r.tools, READ_ONLY);
		assert.match(r.notes.join(" "), /clamped to read-only/);
	});

	it("high keeps shell, but a path fence removes it", () => {
		const open = clampToolsForAutonomy(sub({ autonomy: "high", tools: ["read", "bash"] }));
		assert.deepEqual(open.tools, ["read", "bash"]);

		const fenced = clampToolsForAutonomy(
			sub({ autonomy: "high", tools: ["read", "bash"], paths: ["src"] }),
		);
		assert.deepEqual(fenced.tools, ["read"]);
		assert.match(fenced.notes.join(" "), /paths: shell is off/);
	});

	it("inherit keeps the declared list and warns about host gates", () => {
		const r = clampToolsForAutonomy(sub({ autonomy: "inherit", tools: ["read", "bash"] }));
		assert.deepEqual(r.tools, ["read", "bash"]);
		assert.match(r.notes.join(" "), /host permission gates/);
	});

	it("a read-only list above low still says it grants nothing", () => {
		const r = clampToolsForAutonomy(sub({ autonomy: "high", tools: ["read", "ls"] }));
		assert.match(r.notes.join(" "), /never runs above low/);
	});

	it("off strips codemode from an explicit list", () => {
		const r = clampToolsForAutonomy(sub({ autonomy: "off", tools: ["read", "codemode", "bash"] }));
		assert.deepEqual(r.tools, ["read"]);
	});
});
