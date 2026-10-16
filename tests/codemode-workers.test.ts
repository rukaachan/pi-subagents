/**
 * The codemode worker pool: how many legs can hold a worker at once.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	codemodeContentionNote,
	codemodeLegs,
	CODEMODE_WORKERS_DEFAULT,
	HOST_CODEMODE_WORKERS,
} from "../src/domain/subagent/codemode.ts";
import { clampToolsForAutonomy, type SubagentConfig } from "../src/domain/subagent/config.ts";

const sub = (over: Partial<SubagentConfig> = {}): SubagentConfig => ({
	name: "worker",
	description: "d",
	model: "inherit",
	autonomy: "inherit",
	systemPrompt: "p",
	source: "user",
	filePath: "/x.md",
	warnings: [],
	...over,
});

describe("codemode worker pool", () => {
	it("the host allows two workers per process", () => {
		// The host's own number, from its docs (Codemode → Limits).
		assert.equal(HOST_CODEMODE_WORKERS, 2);
	});

	it("this package asks for a wider pool", () => {
		assert.equal(CODEMODE_WORKERS_DEFAULT, 8);
	});

	it("names the legs that will hold a worker", () => {
		const legs = [sub({ name: "a", codemode: true }), sub({ name: "b" }), sub({ name: "c" })];
		assert.deepEqual(codemodeLegs(legs), ["a", "b", "c"]);
	});

	it("a leg that opted out holds no worker", () => {
		const legs = [sub({ name: "a", codemode: false }), sub({ name: "b" })];
		assert.deepEqual(codemodeLegs(legs), ["b"]);
	});

	it("a clamped read-only leg keeps its clamp", () => {
		const legs = [sub({ name: "a", autonomy: "off", tools: ["read", "bash"] })];
		assert.deepEqual(codemodeLegs(legs), ["a"]);
		assert.match(clampToolsForAutonomy(legs[0] as SubagentConfig).notes.join(" "), /read-only/);
	});

	it("says nothing while the legs fit", () => {
		assert.equal(codemodeContentionNote([]), "");
		assert.equal(codemodeContentionNote(["a"]), "");
		assert.equal(codemodeContentionNote(["a", "b"]), "");
		assert.equal(codemodeContentionNote(["a", "b", "c", "d", "e", "f", "g", "h"]), "");
	});

	it("names the waiting legs when they outnumber the workers", () => {
		const note = codemodeContentionNote(["a", "b", "c"], 2);
		assert.match(note, /3 legs \(a, b, c\)/);
		assert.match(note, /2 workers per pi process/);
		assert.match(note, /wait for a free worker/);
	});

	it("names the pool that is really in force", () => {
		const legs = Array.from({ length: 9 }, (_, i) => `leg${i + 1}`);
		const note = codemodeContentionNote(legs, 8);
		assert.match(note, /9 legs/);
		assert.match(note, /8 workers per pi process/);
	});

	it("the fan-out prints the note it computes", async () => {
		// The note is only useful if the fan-out says it. The driver
		// lives in src/app/fanout.ts; the invariant follows it.
		const text = await (
			await import("node:fs/promises")
		).readFile(new URL("../src/app/fanout.ts", import.meta.url), "utf8");
		assert.match(
			text,
			/codemodeContentionNote\(coders, effectiveCodemodeWorkers\(\)\)/,
			"the fan-out prints the note, with the pool in force",
		);
		assert.match(text, /codemodeLegs\(/, "the fan-out counts the codemode legs it launches");
	});
});
