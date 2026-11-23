/**
 * pi-subagents: a small RPC driver for e2e scenarios.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { E2EHome } from "./home.ts";

const REPO_ROOT = resolvePath(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULT_TIMEOUT = 20_000;

export interface RpcEvent {
	at: number;
	type: string;
	raw: Record<string, unknown>;
}

export interface RpcResponse {
	id?: string;
	type: "response";
	command: string;
	success: boolean;
	data?: Record<string, unknown>;
	error?: unknown;
}

export interface PiRpc {
	events: RpcEvent[];
	responses: RpcResponse[];
	notices: () => string[];
	statuses: () => string[];
	request: (command: Record<string, unknown>, timeoutMs?: number) => Promise<RpcResponse>;
	prompt: (
		text: string,
		opts?: { waitSettled?: boolean; timeoutMs?: number },
	) => Promise<RpcResponse>;
	waitForEvent: (
		check: (event: RpcEvent) => boolean,
		label: string,
		timeoutMs?: number,
		from?: number,
	) => Promise<RpcEvent>;
	waitForNotice: (pattern: RegExp, timeoutMs?: number, from?: number) => Promise<string>;
	waitForStatus: (pattern: RegExp, timeoutMs?: number, from?: number) => Promise<string>;
	waitForExit: (timeoutMs?: number) => Promise<void>;
	stop: () => Promise<void>;
	artifacts: (dir: string) => void;
	stdout: () => string;
	stderr: () => string;
}

const redact = (text: string): string =>
	text
		.replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1[redacted]")
		.replace(/\bsk-[A-Za-z0-9._-]+/g, "sk-[redacted]");

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

function patternText(pattern: RegExp, text: string): boolean {
	pattern.lastIndex = 0;
	return pattern.test(text);
}

export function startRpc(home: E2EHome): PiRpc {
	const child: ChildProcessWithoutNullStreams = spawn(
		process.env.PI_BIN ?? "pi",
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
		{
			cwd: REPO_ROOT,
			env: home.env,
			stdio: ["pipe", "pipe", "pipe"],
		},
	);

	const events: RpcEvent[] = [];
	const responses: RpcResponse[] = [];
	const waiters = new Map<string, (response: RpcResponse) => void>();
	let seq = 0;
	let out = "";
	let err = "";
	let buffer = "";
	let settled = false;

	child.stdout.on("data", (chunk: Buffer) => {
		const text = chunk.toString();
		out += text;
		buffer += text;
		for (;;) {
			const nl = buffer.indexOf("\n");
			if (nl < 0) break;
			const line = buffer.slice(0, nl).replace(/\r$/, "");
			buffer = buffer.slice(nl + 1);
			if (!line.trim()) continue;
			let raw: Record<string, unknown>;
			try {
				raw = JSON.parse(line) as Record<string, unknown>;
			} catch {
				continue;
			}
			const type =
				raw.type === "extension_ui_request" && typeof raw.method === "string"
					? raw.method
					: typeof raw.type === "string"
						? raw.type
						: "unknown";
			events.push({ at: Date.now(), type, raw });
			if (type === "response") {
				const response = raw as unknown as RpcResponse;
				responses.push(response);
				const id = response.id;
				if (id) {
					const wake = waiters.get(id);
					if (wake) {
						waiters.delete(id);
						wake(response);
					}
				}
			}
		}
	});
	child.stderr.on("data", (chunk: Buffer) => {
		err += chunk.toString();
	});

	const stop = async (): Promise<void> => {
		if (child.exitCode !== null || settled) return;
		settled = true;
		try {
			child.stdin.end();
		} catch {
			/* already closed */
		}
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {
					/* already gone */
				}
				resolve();
			}, 3000);
			child.once("exit", () => {
				clearTimeout(timer);
				resolve();
			});
		});
	};

	const request = async (
		command: Record<string, unknown>,
		timeoutMs = DEFAULT_TIMEOUT,
	): Promise<RpcResponse> => {
		const id = `e2e-${seq++}`;
		const response = new Promise<RpcResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				waiters.delete(id);
				reject(new Error(`RPC ${String(command.type)} timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			waiters.set(id, (value) => {
				clearTimeout(timer);
				resolve(value);
			});
		});
		try {
			child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
		} catch (error) {
			waiters.delete(id);
			throw error;
		}
		return response;
	};

	const waitForEvent = async (
		check: (event: RpcEvent) => boolean,
		label: string,
		timeoutMs = DEFAULT_TIMEOUT,
		from = 0,
	): Promise<RpcEvent> => {
		const started = Date.now();
		for (;;) {
			for (let i = from; i < events.length; i += 1) {
				const event = events[i];
				if (event && check(event)) return event;
			}
			if (Date.now() - started > timeoutMs) {
				throw new Error(`timed out waiting for ${label} after ${timeoutMs}ms`);
			}
			await sleep(25);
		}
	};

	const waitForNotice = async (
		pattern: RegExp,
		timeoutMs = DEFAULT_TIMEOUT,
		from = 0,
	): Promise<string> => {
		const event = await waitForEvent(
			(e) =>
				e.type === "notify" &&
				typeof e.raw.message === "string" &&
				patternText(pattern, e.raw.message),
			`notice ${pattern}`,
			timeoutMs,
			from,
		);
		return String(event.raw.message);
	};

	const waitForStatus = async (
		pattern: RegExp,
		timeoutMs = DEFAULT_TIMEOUT,
		from = 0,
	): Promise<string> => {
		const event = await waitForEvent(
			(e) =>
				e.type === "setStatus" &&
				typeof e.raw.statusText === "string" &&
				patternText(pattern, e.raw.statusText),
			`status ${pattern}`,
			timeoutMs,
			from,
		);
		return String(event.raw.statusText);
	};

	const prompt = async (
		text: string,
		opts: { waitSettled?: boolean; timeoutMs?: number } = {},
	): Promise<RpcResponse> => {
		const from = events.length;
		const response = await request(
			{
				type: "prompt",
				message: text,
				...(opts.waitSettled === false ? {} : { streamingBehavior: "followUp" }),
			},
			opts.timeoutMs,
		);
		const disposition = response.data?.disposition;
		if (opts.waitSettled !== false && disposition !== "handled") {
			await waitForEvent(
				(e) => e.type === "agent_settled",
				"agent_settled",
				opts.timeoutMs ?? 60_000,
				from,
			);
		}
		return response;
	};

	const artifacts = (dir: string): void => {
		mkdirSync(dir, { recursive: true });
		const write = (name: string, text: string): void => {
			writeFileSync(join(dir, name), redact(text));
		};
		write("stdout.log", out);
		write("stderr.log", err);
		write("events.ndjson", events.map((e) => JSON.stringify(e.raw)).join("\n"));
		for (const [name, path] of [
			["journal.ndjson", home.journalPath],
			["state.json", home.statePath],
			["hook.ndjson", home.hookPath],
		] as const) {
			if (existsSync(path)) write(name, readFileSync(path, "utf8"));
		}
	};

	return {
		events,
		responses,
		notices: () =>
			events
				.filter((e) => e.type === "notify" && typeof e.raw.message === "string")
				.map((e) => String(e.raw.message)),
		statuses: () =>
			events
				.filter((e) => e.type === "setStatus" && typeof e.raw.statusText === "string")
				.map((e) => String(e.raw.statusText)),
		request,
		prompt,
		waitForEvent,
		waitForNotice,
		waitForStatus,
		waitForExit: (timeoutMs = 5000) =>
			new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					reject(new Error(`Pi did not exit within ${timeoutMs}ms`));
				}, timeoutMs);
				child.once("exit", () => {
					clearTimeout(timer);
					resolve();
				});
			}),
		stop,
		artifacts,
		stdout: () => out,
		stderr: () => err,
	};
}
