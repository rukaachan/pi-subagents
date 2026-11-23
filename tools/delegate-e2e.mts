/**
 * pi-subagents: real end-to-end delegate run over Pi's RPC mode.
 * Run: PI_DELEGATE_E2E=1 npm run e2e:delegate
 *
 * Spawns one Pi process with only this extension, runs a real delegate, and
 * times what a user waits for: admission, the footer's first paint, the
 * settle time, and the payload each report mode sends.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkFrames } from "./session-view-probe.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const frameErrors = checkFrames(true);
if (frameErrors.length > 0) {
	console.error(`session viewer frame is broken: ${frameErrors.join("; ")}`);
	process.exit(1);
}

if (process.env.PI_DELEGATE_E2E !== "1") {
	console.log("Set PI_DELEGATE_E2E=1 to run this (it spends real model calls).");
	process.exit(0);
}

const BODY = "OKTOKEN";
const PROMPT = `Reply with exactly ${BODY} and nothing else. Do not call any tool.`;
const LEGS = (process.env.PI_DELEGATE_E2E_LEGS ?? "explorer,tester").split(",").filter(Boolean);
const TIMEOUT_MS = Number(process.env.PI_DELEGATE_E2E_TIMEOUT_MS ?? 240_000);
const POLLS = Number(process.env.PI_DELEGATE_E2E_POLLS ?? 120);
const POLL_MS = Number(process.env.PI_DELEGATE_E2E_POLL_MS ?? 500);

const child = spawn(
	"pi",
	[
		"-ne",
		"-e",
		"./extensions/index.ts",
		"-nc",
		"-ns",
		"-np",
		"--no-session",
		"--no-mcp",
		"--mode",
		"rpc",
	],
	{ cwd: root, stdio: ["pipe", "pipe", "pipe"] },
);

const t0 = Date.now();
const marks = new Map<string, number>();
const notices: { at: number; text: string }[] = [];
const statuses: { at: number; text: string }[] = [];
let stderr = "";
let stdout = "";

function mark(name: string): void {
	if (!marks.has(name)) marks.set(name, Date.now() - t0);
}

const send = (message: Record<string, unknown>): void => {
	child.stdin.write(`${JSON.stringify(message)}\n`);
};

child.stdout.on("data", (chunk: Buffer) => {
	stdout += chunk.toString();
	for (const line of chunk.toString().split("\n")) {
		if (!line.trim()) continue;
		let event: Record<string, unknown>;
		try {
			event = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		const at = Date.now() - t0;
		if (event.method === "setStatus" && typeof event.statusText === "string") {
			statuses.push({ at, text: event.statusText });
			mark("footer first paint");
		}
		if (event.method === "notify" && typeof event.message === "string") {
			notices.push({ at, text: event.message });
		}
	}
});
child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

function waitFor(check: () => boolean, label: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const timer = setInterval(() => {
			if (check()) {
				clearInterval(timer);
				resolve();
				return;
			}
			if (Date.now() - started > TIMEOUT_MS) {
				clearInterval(timer);
				reject(new Error(`timeout waiting for ${label} after ${TIMEOUT_MS}ms`));
			}
		}, 50);
	});
}

let asked = 0;

async function ask(message: string, label: string): Promise<string> {
	send({ type: "prompt", message });
	asked += 1;
	const want = asked;
	await waitFor(() => notices.length >= want, label);
	return notices[want - 1]?.text ?? "";
}

function table(title: string, rows: [string, string][]): void {
	console.log(`\n${title}`);
	const width = rows.reduce((n, [k]) => Math.max(n, k.length), 0);
	for (const [k, v] of rows) console.log(`  ${k.padEnd(width)}  ${v}`);
}

function lineCount(text: string, pattern: RegExp): number {
	return text.split("\n").filter((line) => pattern.test(line)).length;
}

try {
	const started = await ask(`/delegate @${LEGS.join(",@")} ${PROMPT}`, "admission notice");
	const ids = [...started.matchAll(/task-[a-z0-9-]+/g)].map((m) => m[0]);
	if (ids.length !== LEGS.length) {
		throw new Error(`expected ${LEGS.length} task ids, got ${ids.length}: ${started.text}`);
	}
	mark("legs accepted");

	const status = await ask("/delegate status", "status notice");
	mark("status answered");

	let settled = status;
	for (let poll = 0; poll < POLLS; poll += 1) {
		if (/Nothing live/.test(settled)) break;
		await new Promise<void>((resolve) => {
			setTimeout(resolve, POLL_MS);
		});
		settled = await ask("/delegate status", `completion poll ${poll + 1}`);
	}
	if (!/Nothing live/.test(settled)) throw new Error("legs never settled");
	mark("legs settled");

	const reports = await ask("/delegate reports", "reports notice");
	mark("reports answered");

	const drill = await ask(`/delegate report ${LEGS[0]}`, "drill-down notice");
	mark("drill-down answered");

	const opened = await ask(`/delegate open ${LEGS[0]}`, "open notice");
	mark("open answered");

	const usage = await ask("/delegate", "usage notice");

	child.stdin.end();
	await new Promise<void>((resolve) => {
		child.on("exit", () => resolve());
	});

	table("e2e wall clock (ms from spawn)", [
		["legs accepted", String(marks.get("legs accepted") ?? -1)],
		["footer first paint", String(marks.get("footer first paint") ?? -1)],
		["status answered", String(marks.get("status answered") ?? -1)],
		["legs settled", String(marks.get("legs settled") ?? -1)],
		["reports answered", String(marks.get("reports answered") ?? -1)],
		["drill-down answered", String(marks.get("drill-down answered") ?? -1)],
		["open answered", String(marks.get("open answered") ?? -1)],
	]);
	table("notify payload (chars)", [
		["admission", String(started.length)],
		["status", String(status.length)],
		["reports (compact)", String(reports.length)],
		["report <leg> (full)", String(drill.length)],
		["usage", String(usage.length)],
	]);
	const bodyLines = lineCount(reports, new RegExp(`^${BODY}$`));
	const compactRows = lineCount(reports, /· (DONE|ERROR|STOPPED)/);
	const drillHasBody = drill.split("\n").includes(BODY);
	const openShowsTask = /you\s+.*Reply with exactly/.test(opened);
	table("checks", [
		["footer events", String(statuses.length)],
		["compact rows", String(compactRows)],
		["compact hides bodies", bodyLines === 0 ? "yes" : "NO"],
		["drill-down shows the body", drillHasBody ? "yes" : "NO"],
		["reports mentions done", /done/.test(reports) ? "yes" : "NO"],
		["open shows transcript", openShowsTask ? "yes" : "NO"],
	]);

	const failures: string[] = [];
	if (statuses.length === 0) failures.push("no footer status event");
	if (compactRows !== LEGS.length)
		failures.push(`compact showed ${compactRows}/${LEGS.length} legs`);
	if (bodyLines > 0) failures.push("compact reports leaked a full body");
	if (!drillHasBody) failures.push("drill-down did not show the leg body");
	if (!openShowsTask) failures.push("open did not show the transcript");

	if (failures.length > 0) {
		console.error(`\ne2e FAILED: ${failures.join("; ")}`);
		if (stderr) console.error(stderr.slice(0, 2000));
		process.exit(1);
	}
	console.log("\ne2e OK");
} catch (err) {
	console.error(`\ne2e FAILED: ${err instanceof Error ? err.message : String(err)}`);
	if (stderr) console.error(stderr.slice(0, 2000));
	if (stdout) console.error(stdout.slice(-2000));
	child.kill();
	process.exit(1);
}
