/**
 * Live smoke against a real provider: Task, Team start, steer, resume.
 *
 * Run: PI_IT_LIVE=1 PI_IT_MODEL=provider/model npm run smoke:live
 * Manual/nightly only; never a CI gate.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSubagentFromContent } from "../src/infra/files/index.ts";
import { launchBackground, resumeTask } from "../src/app/background.ts";
import { startTeamLaunch } from "../src/app/team-launch.ts";
import { steerTask } from "../src/app/task-actions.ts";
import { liveSession } from "../src/app/live-sessions.ts";
import { TaskStore } from "../src/domain/task/index.ts";
import { bindTeamMail, clearTeamMail } from "../src/app/team-mail.ts";
import { stopAllLiveRuns } from "../src/app/stop-all.ts";

const modelId = process.env.PI_IT_MODEL?.trim() ?? "";
if (process.env.PI_IT_LIVE !== "1" || !modelId) {
	console.log("LIVE_SMOKE_SKIP set PI_IT_LIVE=1 and PI_IT_MODEL=provider/model");
	process.exit(0);
}

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

async function waitDone(store: TaskStore, taskId: string, label: string): Promise<string> {
	const started = Date.now();
	for (;;) {
		const row = store.get(taskId);
		if (row && row.status !== "running") {
			assert.equal(row.status, "done", `${label}: ${row.error ?? row.status}`);
			return row.result?.text ?? "";
		}
		if (Date.now() - started > 90_000) throw new Error(`${label}: no settle in 90s`);
		await sleep(100);
	}
}

const dir = mkdtempSync(join(tmpdir(), "pi-live-smoke-"));
const journalPath = join(dir, "journal.ndjson");
process.env.PI_SUBAGENTS_JOURNAL = journalPath;
const subs = join(dir, ".pi", "subagents");
mkdirSync(subs, { recursive: true });
const markdown = [
	"---",
	"name: live-worker",
	"description: live smoke worker",
	`model: ${modelId}`,
	"thinkingLevel: off",
	"autonomy: high",
	"codemode: false",
	"tools: bash, read",
	"budget: { timeoutSec: 120, maxTurns: 0, maxInputTokens: 0, maxReportChars: 2000 }",
	"---",
	"",
	"Follow the task exactly. Keep the final report to one line.",
].join("\n");
writeFileSync(join(subs, "live-worker.md"), markdown);
const gatedMarkdown = [
	"---",
	"name: live-gated",
	"description: live smoke gate",
	`model: ${modelId}`,
	"thinkingLevel: off",
	"autonomy: high",
	"gates: on",
	"codemode: false",
	"tools: bash",
	"budget: { timeoutSec: 120, maxTurns: 0, maxInputTokens: 0, maxReportChars: 2000 }",
	"---",
	"",
	"Run the command the task gives you with bash. If it is blocked, report the block reason.",
].join("\n");
writeFileSync(join(subs, "live-gated.md"), gatedMarkdown);

const pi = await import("@earendil-works/pi-coding-agent");
const host = pi as unknown as {
	ModelRuntime: { create(): Promise<unknown> };
	ModelRegistry: new (runtime: unknown) => {
		find(provider: string, id: string): unknown;
	};
};
const runtime = await host.ModelRuntime.create();
const registry = new host.ModelRegistry(runtime);
const slash = modelId.indexOf("/");
const model = registry.find(modelId.slice(0, slash), modelId.slice(slash + 1));
assert.ok(model, `model not found: ${modelId}`);

const ctx = {
	ui: { notify() {}, setStatus() {} },
	model,
	modelRegistry: registry,
	thinkingLevel: "off",
	cwd: dir,
	sessionManager: { getSessionId: () => "live-smoke" },
	isProjectTrusted: () => false,
} as never;
const sub = loadSubagentFromContent(markdown, join(subs, "live-worker.md"), "project");
assert.equal(typeof sub, "object", "fixture parses");
if (typeof sub === "string") throw new Error(sub);
const gated = loadSubagentFromContent(gatedMarkdown, join(subs, "live-gated.md"), "project");
assert.equal(typeof gated, "object", "gated fixture parses");
if (typeof gated === "string") throw new Error(gated);

const store = new TaskStore();
bindTeamMail(store);
clearTeamMail();
try {
	const taskId = launchBackground(
		store,
		sub,
		"live task",
		"Reply with exactly LIVE_TASK_OK. Do not call any tool.",
		dir,
		ctx,
		{ kind: "background" },
	);
	assert.match(await waitDone(store, taskId, "task"), /LIVE_TASK_OK/);
	console.log("task: LIVE_TASK_OK");

	const startedTeam = await startTeamLaunch(
		store,
		{
			prompt: "Reply with exactly LIVE_TEAM_OK. Do not call any tool.",
			roster: ["live-worker"],
		},
		ctx,
	);
	assert.equal(startedTeam.ok, true, startedTeam.ok ? "" : startedTeam.error);
	if (!startedTeam.ok) throw new Error(startedTeam.error);
	const legId = startedTeam.tasks[0]?.runId;
	assert.ok(legId, "team leg has a run row");
	if (legId) assert.match(await waitDone(store, legId, "team leg"), /LIVE_TEAM_OK/);
	console.log("team: LIVE_TEAM_OK");

	const longId = launchBackground(
		store,
		sub,
		"live steer",
		'First call bash with command "sleep 5". Then reply with the last steer text you received.',
		dir,
		ctx,
		{ kind: "background" },
	);
	let live = false;
	for (let i = 0; i < 100 && !live; i += 1) {
		live = Boolean(liveSession(longId)?.steer);
		if (!live) await sleep(100);
	}
	assert.ok(live, "steer target is live");
	const steered = await steerTask(store, longId, "LIVE_STEER_TEXT");
	assert.equal(steered.ok, true, steered.message);
	assert.match(await waitDone(store, longId, "steer"), /LIVE_STEER_TEXT/);
	console.log("steer: LIVE_STEER_TEXT");

	const resumed = await resumeTask(
		store,
		taskId,
		"live-worker",
		"Reply with exactly LIVE_RESUME_OK. Do not call any tool.",
		ctx,
	);
	assert.ok(!("error" in resumed), "resume accepted");
	if ("error" in resumed) throw new Error(resumed.error);
	assert.match(await waitDone(store, resumed.taskId, "resume"), /LIVE_RESUME_OK/);
	console.log("resume: LIVE_RESUME_OK");

	const probe = "/tmp/pi-live-gate-probe";
	mkdirSync(probe, { recursive: true });
	writeFileSync(join(probe, "keep.txt"), "alive");
	const gateId = launchBackground(
		store,
		gated,
		"live gate",
		`Call bash with the exact command: rm -rf ${probe}. Then reply with GATE_DONE.`,
		dir,
		ctx,
		{ kind: "background" },
	);
	const gateReport = await waitDone(store, gateId, "gate");
	assert.match(gateReport, /gates|recursive delete|blocked/i);
	assert.equal(existsSync(join(probe, "keep.txt")), true, "the gate kept the probe dir");
	const journalLines = readFileSync(journalPath, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { event?: string; tool?: string; reason?: string });
	const blocked = journalLines.find((line) => line.event === "gate");
	assert.ok(blocked, "the gate wrote its journal line");
	assert.equal(blocked.tool, "bash");
	assert.equal(blocked.reason, "recursive delete (bash)");
	rmSync(probe, { recursive: true, force: true });
	console.log("gate: recursive delete (bash)");
	console.log("LIVE_SMOKE_OK");
} finally {
	stopAllLiveRuns("live smoke");
	clearTeamMail();
	rmSync(dir, { recursive: true, force: true });
}
