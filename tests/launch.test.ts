import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	defaultLegs,
	findLaunchLeg,
	parseOpenQuery,
	parseReportQuery,
	parseLaunchArgs,
	rosterFor,
	unknownLegs,
} from "../src/domain/policy/index.ts";
import { TaskStore } from "../src/domain/task/index.ts";
import { MAX_LIVE_TASKS, newRecord } from "../src/domain/task/index.ts";
import { queuedLegCount, startLaunch, stopLaunchSchedulers } from "../src/app/launch/index.ts";
import { discoverSubagents } from "../src/infra/files/index.ts";
import { withTemps } from "../src/domain/run/index.ts";
import { footerProgress } from "../src/telemetry/live/index.ts";
import type { SubagentConfig } from "../src/domain/subagent/index.ts";

const sub: SubagentConfig = {
	name: "explorer",
	description: "",
	model: "inherit",
	autonomy: "low",
	systemPrompt: "p",
	source: "user",
	filePath: "f",
	warnings: [],
};

describe("parseLaunchArgs", () => {
	it("treats a bare prompt as the default roster", () => {
		assert.deepEqual(parseLaunchArgs("map the auth flow"), {
			ok: true,
			request: { roster: null, prompt: "map the auth flow" },
		});
	});

	it("takes free text exactly as typed", () => {
		assert.deepEqual(parseLaunchArgs("get overview this repo"), {
			ok: true,
			request: { roster: null, prompt: "get overview this repo" },
		});
	});

	it("reads a comma-separated roster before the prompt", () => {
		assert.deepEqual(parseLaunchArgs("@explorer,@tester review the diff"), {
			ok: true,
			request: { roster: ["explorer", "tester"], prompt: "review the diff" },
		});
	});

	it("reads space-separated roster tokens", () => {
		assert.deepEqual(parseLaunchArgs("@explorer, @tester review the diff"), {
			ok: true,
			request: { roster: ["explorer", "tester"], prompt: "review the diff" },
		});
	});

	it("dedupes a repeated leg", () => {
		const parsed = parseLaunchArgs("@explorer,@explorer go");
		assert.ok(parsed.ok);
		assert.deepEqual(parsed.request.roster, ["explorer"]);
	});

	it("keeps the prompt intact, including newlines", () => {
		const parsed = parseLaunchArgs("@worker fix the bug\nand add a test");
		assert.ok(parsed.ok);
		assert.equal(parsed.request.prompt, "fix the bug\nand add a test");
	});

	it("refuses a missing prompt instead of guessing", () => {
		assert.equal(parseLaunchArgs("").ok, false);
		assert.equal(parseLaunchArgs("@explorer,@tester").ok, false);
	});

	it("refuses an empty roster token", () => {
		assert.equal(parseLaunchArgs("@ go").ok, false);
	});
});

describe("default rosters", () => {
	const all = ["code-reviewer", "explorer", "planner", "researcher", "tester", "worker"];

	it("team start defaults to every discovered subagent", () => {
		assert.deepEqual(defaultLegs("team", all), all);
	});

	it("delegate defaults to explorer + worker", () => {
		assert.deepEqual(defaultLegs("delegate", all), ["explorer", "worker"]);
	});

	it("a named roster wins over the default and is deduped", () => {
		assert.deepEqual(rosterFor("team", ["tester", "tester", "explorer"], all), [
			"tester",
			"explorer",
		]);
		assert.deepEqual(rosterFor("delegate", null, all), ["explorer", "worker"]);
	});

	it("names the legs that do not exist", () => {
		assert.deepEqual(unknownLegs(["explorer", "ghost"], all), ["ghost"]);
		assert.deepEqual(unknownLegs(["explorer"], all), []);
	});
});

describe("parseReportQuery", () => {
	it("reads the compact and live forms", () => {
		assert.deepEqual(parseReportQuery("reports"), { mode: "compact" });
		assert.deepEqual(parseReportQuery(" REPORT "), { mode: "compact" });
		assert.deepEqual(parseReportQuery("status"), { mode: "status" });
	});

	it("reads a drill-down target", () => {
		assert.deepEqual(parseReportQuery("report explorer"), { mode: "full", target: "explorer" });
		assert.deepEqual(parseReportQuery("reports @tester"), { mode: "full", target: "tester" });
	});

	it("leaves a task prompt alone", () => {
		assert.equal(parseReportQuery("get overview this repo"), null);
		assert.equal(parseReportQuery("review the reports folder"), null);
	});
});

describe("launch footer wiring", () => {
	it("points the progress sink at the footer so live legs are visible", (t) => {
		const { subagents } = withTemps(discoverSubagents(process.cwd()));
		const names = subagents.map((s) => s.name).slice(0, 2);
		if (names.length === 0) {
			t.skip("no subagents installed");
			return;
		}
		const store = new TaskStore();
		for (let i = 0; i < MAX_LIVE_TASKS; i++) {
			store.add(newRecord(sub, "fill", "/tmp", "background"));
		}
		const statuses: (string | undefined)[] = [];
		const ctx = {
			cwd: process.cwd(),
			ui: { setStatus: (_key: string, text: string | undefined) => statuses.push(text) },
		} as never;
		const started = startLaunch(store, "delegate", names, "probe", ctx);
		assert.ok(started.ok);
		assert.equal(queuedLegCount(), names.length);
		assert.equal(queuedLegCount("another-session"), 0);
		footerProgress.start("probe-key", "probe legend");
		assert.ok(
			statuses.some((line) => line?.includes("probe legend")),
			"footer got the live line",
		);
		footerProgress.finish("probe-key");
		footerProgress.setSink(() => {});
		stopLaunchSchedulers();
		assert.equal(queuedLegCount(), 0);
	});
});

describe("TaskStore.subscribe", () => {
	it("fires on add, touch, and remove, and stops after unsubscribe", () => {
		const store = new TaskStore();
		let seen = 0;
		const off = store.subscribe(() => {
			seen += 1;
		});
		const rec = newRecord(sub, "t", "/tmp", "parallel");
		store.add(rec);
		store.touch();
		store.remove(rec.taskId);
		assert.equal(seen, 3);
		off();
		store.add(newRecord(sub, "t", "/tmp", "parallel"));
		assert.equal(seen, 3);
	});

	it("a throwing listener does not block the others", () => {
		const store = new TaskStore();
		let seen = 0;
		store.subscribe(() => {
			throw new Error("boom");
		});
		store.subscribe(() => {
			seen += 1;
		});
		store.add(newRecord(sub, "t", "/tmp", "parallel"));
		assert.equal(seen, 1);
	});
});

describe("the open grammar", () => {
	const roster = [
		{ name: "worker", taskId: "task-aaa-1111", status: "done" },
		{ name: "tester", taskId: "task-bbb-2222", status: "running" },
		{ name: "explorer", taskId: "task-aaa-3333", status: "queued" },
	];

	it("reads only the open head", () => {
		assert.equal(parseOpenQuery("open worker"), "worker");
		assert.equal(parseOpenQuery("open @tester"), "tester");
		assert.equal(parseOpenQuery("OPEN  2222"), "2222");
		assert.equal(parseOpenQuery("open"), "");
		assert.equal(parseOpenQuery("opening worker"), null);
		assert.equal(parseOpenQuery("open the bug please"), "the bug please");
		assert.equal(parseOpenQuery("reports"), null);
	});

	it("is not part of the report grammar", () => {
		assert.equal(parseReportQuery("open worker"), null);
	});

	it("finds a leg by name, id, suffix, or unique prefix", () => {
		const byName = findLaunchLeg(roster, "worker");
		assert.equal(byName.ok && byName.leg.taskId, "task-aaa-1111");
		const byId = findLaunchLeg(roster, "task-bbb-2222");
		assert.equal(byId.ok && byId.leg.name, "tester");
		const bySuffix = findLaunchLeg(roster, "3333");
		assert.equal(bySuffix.ok && bySuffix.leg.name, "explorer");
		const byPrefix = findLaunchLeg(roster, "task-b");
		assert.equal(byPrefix.ok && byPrefix.leg.name, "tester");
	});

	it("lists matches when the target is ambiguous", () => {
		const out = findLaunchLeg(roster, "task-a");
		assert.equal(out.ok, false);
		assert.equal(out.ok === false && out.matches?.length, 2);
		assert.match(out.ok === false ? out.error : "", /matches 2 legs/);
	});

	it("says which legs exist when there is no hit", () => {
		const out = findLaunchLeg(roster, "nope");
		assert.equal(out.ok, false);
		assert.match(out.ok === false ? out.error : "", /worker, tester, explorer/);
		assert.equal(findLaunchLeg(roster, "@").ok, false);
	});
});
