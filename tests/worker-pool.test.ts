/**
 * The package's codemode worker pool.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { applyCodemodeWorkerDefault, effectiveCodemodeWorkers } from "../src/infra/worker-pool.ts";
import { CODEMODE_WORKERS_DEFAULT } from "../src/domain/subagent/codemode.ts";

const KEY = "PI_CODEMODE_MAX_WORKERS";
const saved = process.env[KEY];

afterEach(() => {
	if (saved === undefined) delete process.env[KEY];
	else process.env[KEY] = saved;
});

describe("the codemode worker pool", () => {
	it("fills in the default when the operator chose nothing", () => {
		delete process.env[KEY];
		assert.equal(applyCodemodeWorkerDefault(), true, "the package set the value");
		assert.equal(process.env[KEY], String(CODEMODE_WORKERS_DEFAULT));
		assert.equal(effectiveCodemodeWorkers(), CODEMODE_WORKERS_DEFAULT);
	});

	it("keeps the operator's own number", () => {
		process.env[KEY] = "16";
		assert.equal(applyCodemodeWorkerDefault(), false, "the value was left alone");
		assert.equal(process.env[KEY], "16");
		assert.equal(effectiveCodemodeWorkers(), 16);
	});

	it("keeps a smaller operator number too", () => {
		// A smaller pool is a choice, not a mistake: the host reads this
		// value on every script call, so the operator can lower it.
		process.env[KEY] = "2";
		assert.equal(applyCodemodeWorkerDefault(), false);
		assert.equal(effectiveCodemodeWorkers(), 2);
	});

	it("falls back to the default for a nonsense value", () => {
		process.env[KEY] = "many";
		assert.equal(effectiveCodemodeWorkers(), CODEMODE_WORKERS_DEFAULT);
		assert.equal(applyCodemodeWorkerDefault(), true, "the nonsense value is replaced");
		assert.equal(process.env[KEY], String(CODEMODE_WORKERS_DEFAULT));
	});

	it("the extension wires it in at load", () => {
		// The pool must be in force before the first script runs, so the
		// wiring belongs in the extension entry.
		const text = readFileSync(new URL("../extensions/index.ts", import.meta.url), "utf8");
		assert.match(text, /applyCodemodeWorkerDefault\(\)/, "the extension sets the pool");
	});
});
