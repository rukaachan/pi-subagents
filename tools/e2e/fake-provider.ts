/**
 * pi-subagents: a local OpenAI-compatible server for e2e runs.
 *
 * It is a contract fake for the provider edge, not a mock of our own code.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeRequest {
	at: number;
	path: string;
	body: unknown;
	/** Last user message text, flattened. */
	prompt: string;
}

export interface FakeProvider {
	/** `http://127.0.0.1:<port>/v1` for models.json. */
	baseUrl: string;
	requests: FakeRequest[];
	close: () => Promise<void>;
}

export interface FakeProviderOptions {
	/** Delay every answer, to keep legs in the live queue. */
	delayMs?: number;
	/** The command a gate scenario asks the child to run. */
	commandFor?: () => string;
}

/** The system text a provider received, wherever this API puts it. */
export function systemText(body: unknown): string {
	const b = body as { instructions?: unknown; system?: unknown } | undefined;
	const parts: string[] = [];
	if (typeof b?.instructions === "string") parts.push(b.instructions);
	if (typeof b?.system === "string") parts.push(b.system);
	else if (Array.isArray(b?.system)) parts.push(textOf(b.system));
	const messages = messagesOf(body);
	for (const message of messages) {
		if (message.role === "system" || message.role === "developer")
			parts.push(textOf(message.content));
	}
	return parts.join("\n");
}

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const out: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object") {
			const b = block as Record<string, unknown>;
			if (typeof b.text === "string") out.push(b.text);
		}
	}
	return out.join("\n");
}

function messagesOf(body: unknown): Record<string, unknown>[] {
	const b = body as { messages?: unknown } | undefined;
	return Array.isArray(b?.messages)
		? b.messages.filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
		: [];
}

function lastUser(messages: Record<string, unknown>[]): string {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const m = messages[i];
		if (m?.role === "user") return textOf(m.content);
	}
	return "";
}

function tokens(text: string): Set<string> {
	return new Set(
		text
			.toUpperCase()
			.split(/[^A-Z0-9_]+/)
			.map((t) => t.trim())
			.filter(Boolean),
	);
}

function hasToken(text: string, token: string): boolean {
	return tokens(text).has(token);
}

function toolResult(messages: Record<string, unknown>[]): boolean {
	return messages.some((m) => m.role === "tool" || m.role === "toolResult");
}

function lastToolText(messages: Record<string, unknown>[]): string {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message?.role === "tool" || message?.role === "toolResult") {
			return textOf(message.content);
		}
	}
	return "";
}

interface ToolCall {
	name: string;
	args: Record<string, unknown>;
}

function lastToolCall(messages: Record<string, unknown>[]): ToolCall | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const calls = messages[i]?.tool_calls;
		if (!Array.isArray(calls)) continue;
		const first = calls[0] as Record<string, unknown> | undefined;
		const fn = first?.function as Record<string, unknown> | undefined;
		if (typeof fn?.name !== "string") continue;
		let args: Record<string, unknown> = {};
		try {
			args = JSON.parse(String(fn.arguments ?? "{}")) as Record<string, unknown>;
		} catch {
			/* keep an empty object */
		}
		return { name: fn.name, args };
	}
	return undefined;
}

function toolCalls(messages: Record<string, unknown>[]): ToolCall[] {
	const out: ToolCall[] = [];
	for (const message of messages) {
		const calls = message.tool_calls;
		if (!Array.isArray(calls)) continue;
		for (const raw of calls) {
			const fn = (raw as Record<string, unknown>)?.function as Record<string, unknown> | undefined;
			if (typeof fn?.name !== "string") continue;
			let args: Record<string, unknown> = {};
			try {
				args = JSON.parse(String(fn.arguments ?? "{}")) as Record<string, unknown>;
			} catch {
				/* keep an empty object */
			}
			out.push({ name: fn.name, args });
		}
	}
	return out;
}

function taskId(text: string): string {
	return text.match(/task-[a-z0-9]+-\d+/i)?.[0] ?? "task-missing";
}

function namedTask(prompt: string, all: string): string {
	return prompt.match(/task-[a-z0-9]+-\d+/i)?.[0] ?? taskId(all);
}

function boardTask(all: string): string {
	return all.match(/task-\d+/)?.[0] ?? "task-1";
}

interface Answer {
	tool?: ToolCall;
	text?: string;
	status?: number;
	finish?: string;
	delayMs?: number;
}

function answerFor(
	messages: Record<string, unknown>[],
	state: { retry: number },
	opts: FakeProviderOptions,
): Answer {
	const prompt = lastUser(messages);
	const all = messages.map((m) => textOf(m.content)).join("\n");

	if (hasToken(prompt, "E2E_CTX")) {
		const calls = toolCalls(messages);
		const tasks = calls.filter((call) => call.name === "Task");
		if (tasks.length === 0)
			return {
				tool: {
					name: "Task",
					args: {
						description: "e2e context on",
						subagent_type: "e2e-context",
						prompt: "E2E_CTX_CHILD_ON",
						run_in_background: false,
					},
				},
			};
		if (tasks.length === 1)
			return {
				tool: {
					name: "Task",
					args: {
						description: "e2e context off",
						subagent_type: "e2e-nocontext",
						prompt: "E2E_CTX_CHILD_OFF",
						run_in_background: false,
					},
				},
			};
		return { text: "CTX_DONE" };
	}
	if (hasToken(prompt, "E2E_CTX_CHILD_ON")) return { text: "CTX_CHILD_ON_OK" };
	if (hasToken(prompt, "E2E_CTX_CHILD_OFF")) return { text: "CTX_CHILD_OFF_OK" };

	const gateCommand = opts.commandFor?.() ?? "true";
	if (hasToken(prompt, "E2E_GATE_ON_DIRECT") || hasToken(prompt, "E2E_GATE_OFF_DIRECT")) {
		const on = hasToken(prompt, "E2E_GATE_ON_DIRECT");
		if (toolResult(messages) && lastToolCall(messages)?.name === "Task")
			return { text: "GATE_PARENT_DONE" };
		return {
			tool: {
				name: "Task",
				args: {
					description: "e2e gate",
					subagent_type: on ? "e2e-gate" : "e2e-nogate",
					prompt: "E2E_GATE_DIRECT",
				},
			},
		};
	}
	if (hasToken(prompt, "E2E_GATE_ON_NESTED")) {
		if (toolResult(messages) && lastToolCall(messages)?.name === "Task")
			return { text: "GATE_PARENT_DONE" };
		return {
			tool: {
				name: "Task",
				args: { description: "e2e gate", subagent_type: "e2e-gate", prompt: "E2E_GATE_NESTED" },
			},
		};
	}
	if (hasToken(prompt, "E2E_GATE_DIRECT") || hasToken(prompt, "E2E_GATE_NESTED")) {
		if (hasToken(prompt, "E2E_GATE_NESTED")) {
			if (!toolResult(messages))
				return {
					tool: {
						name: "codemode",
						args: {
							code: `const r = await tools.bash({ command: ${JSON.stringify(gateCommand)} }); return r;`,
						},
					},
				};
			return { text: `NESTED_REPORT ${lastToolText(messages)}` };
		}
		if (!toolResult(messages)) return { tool: { name: "bash", args: { command: gateCommand } } };
		return { text: `DIRECT_REPORT ${lastToolText(messages)}` };
	}

	// The wake turn starts from the settle notice, so it wins over the tool result.
	const latest = messages.at(-1);
	if (latest && textOf(latest.content).includes("[subagent settled]")) return { text: "WOKEN" };

	// A team leg sees the coordination block prepended to its task prompt.
	const teamMatch = all.match(/\[team\] You are "([^"]+)"/);
	if (latest && textOf(latest.content).includes("[team message]") && !teamMatch)
		return { text: "PING_WOKEN" };
	if (teamMatch) {
		const member = teamMatch[1] ?? "worker";
		const peer = member === "worker" ? "worker-2" : "worker";
		const calls = toolCalls(messages);
		const last = calls.at(-1);
		if (all.includes("E2E_MAIL_SEND")) {
			if (!last)
				return {
					tool: {
						name: "Team",
						args: { action: "claim", task_id: "task-1", expected_revision: 1 },
					},
				};
			if (last.name === "Team" && last.args.action === "claim")
				return {
					tool: {
						name: "TeamMessage",
						args: { action: "send", to: peer, text: "found the bug in parser" },
					},
				};
			if (last.name === "TeamMessage" && last.args.action === "send")
				return {
					tool: {
						name: "Team",
						args: { action: "complete", task_id: "task-1", expected_revision: 2 },
					},
				};
			if (last.name === "Team" && last.args.action === "complete") return { text: "MAIL_SENT" };
		}
		if (all.includes("E2E_MAIL_WAIT")) {
			if (!last)
				return {
					tool: {
						name: "Team",
						args: { action: "claim", task_id: "task-2", expected_revision: 1 },
					},
				};
			if (last.name === "Team" && last.args.action === "claim")
				return { tool: { name: "TeamMessage", args: { action: "wait", to: peer } } };
			if (last.name === "TeamMessage" && last.args.action === "wait")
				return {
					tool: {
						name: "Team",
						args: { action: "complete", task_id: "task-2", expected_revision: 2 },
					},
				};
			if (last.name === "Team" && last.args.action === "complete")
				return { text: "MAIL_RECEIVED: found the bug in parser" };
		}
		if (all.includes("E2E_PING")) {
			if (!last)
				return {
					tool: {
						name: "Team",
						args: { action: "claim", task_id: "task-1", expected_revision: 1 },
					},
				};
			if (last.name === "Team" && last.args.action === "claim")
				return {
					tool: {
						name: "TeamMessage",
						args: { action: "send", to: "lead", text: "ping from the worker" },
					},
				};
			if (last.name === "TeamMessage" && last.args.action === "send")
				return {
					tool: {
						name: "Team",
						args: { action: "complete", task_id: "task-1", expected_revision: 2 },
					},
				};
			if (last.name === "Team" && last.args.action === "complete") return { text: "PING_SENT" };
		}
		const failing = all.includes("E2E_TEAM_FAIL");
		const call = lastToolCall(messages);
		const assigned = boardTask(all);
		if (toolResult(messages) && call?.name === "Team") {
			if (call.args.action === "claim") {
				if (failing) return { finish: "content_filter" };
				return {
					tool: {
						name: "Team",
						args: { action: "complete", task_id: assigned, expected_revision: 2 },
					},
				};
			}
			if (call.args.action === "complete") return { text: "TEAM_DONE" };
		}
		return {
			tool: {
				name: "Team",
				args: { action: "claim", task_id: assigned, expected_revision: 1 },
			},
		};
	}
	if (hasToken(prompt, "E2E_MCP_CHILD")) {
		const call = lastToolCall(messages);
		if (!toolResult(messages) || call?.name !== "codemode")
			return {
				tool: {
					name: "codemode",
					args: {
						code: 'const r = await tools.mcp__echo__echo({ text: "mcp-ok" }); return r;',
					},
				},
			};
		return { text: lastToolText(messages).includes("mcp-ok") ? "MCP_PROVEN" : "MCP_MISSING" };
	}
	if (hasToken(prompt, "E2E_MCP")) {
		return {
			tool: {
				name: "Task",
				args: {
					description: "e2e mcp",
					subagent_type: "e2e-mcp",
					prompt: "E2E_MCP_CHILD",
					run_in_background: true,
				},
			},
		};
	}
	if (hasToken(prompt, "E2E_ONE_JOB") && !toolResult(messages)) {
		return {
			tool: {
				name: "Task",
				args: {
					description: "one job",
					subagent_type: "worker",
					prompt: "E2E_ONE_CHILD",
					run_in_background: true,
				},
			},
		};
	}
	if (hasToken(prompt, "E2E_HYBRID_START")) {
		const calls = toolCalls(messages);
		const started = calls.some((call) => call.name === "Team" && call.args.action === "start");
		if (!started)
			return {
				tool: {
					name: "Team",
					args: {
						action: "start",
						prompt: "E2E_HYBRID_START",
						roster: ["worker"],
					},
				},
			};
		return { text: "HYBRID_STARTED" };
	}
	if (hasToken(prompt, "E2E_TEAM_MAIL")) {
		const calls = toolCalls(messages);
		const creates = calls.filter((call) => call.name === "Team" && call.args.action === "create");
		if (creates.length === 0)
			return {
				tool: {
					name: "Team",
					args: {
						action: "create",
						subject: "mail A",
						description: "",
						write_scopes: ["src/a"],
					},
				},
			};
		if (creates.length === 1)
			return {
				tool: {
					name: "Team",
					args: {
						action: "create",
						subject: "mail B",
						description: "",
						write_scopes: ["src/b"],
					},
				},
			};
		const tasks = calls.filter((call) => call.name === "Task");
		if (tasks.length === 0)
			return {
				tool: {
					name: "Task",
					args: {
						description: "e2e mail A",
						subagent_type: "worker",
						prompt: "Claim task-1 E2E_MAIL_SEND",
						run_in_background: true,
					},
				},
			};
		if (tasks.length === 1)
			return {
				tool: {
					name: "Task",
					args: {
						description: "e2e mail B",
						subagent_type: "worker",
						prompt: "Claim task-2 E2E_MAIL_WAIT",
						run_in_background: true,
					},
				},
			};
		const waits = calls.filter(
			(call) => call.name === "TeamMessage" && call.args.action === "wait",
		);
		if (waits.length === 0)
			return { tool: { name: "TeamMessage", args: { action: "wait", to: "worker" } } };
		if (waits.length === 1)
			return { tool: { name: "TeamMessage", args: { action: "wait", to: "worker-2" } } };
		return { text: "LEAD_SAW_MAIL" };
	}
	if (hasToken(prompt, "E2E_TEAM_PING")) {
		const calls = toolCalls(messages);
		const creates = calls.filter((call) => call.name === "Team" && call.args.action === "create");
		if (creates.length === 0)
			return {
				tool: {
					name: "Team",
					args: { action: "create", subject: "ping task", description: "" },
				},
			};
		const tasks = calls.filter((call) => call.name === "Task");
		if (tasks.length === 0)
			return {
				tool: {
					name: "Task",
					args: {
						description: "e2e ping",
						subagent_type: "worker",
						prompt: "Claim task-1 E2E_PING",
						run_in_background: true,
					},
				},
			};
		return { text: "PING_WAITING" };
	}
	const teamFail = prompt.includes("E2E_TEAM_FAIL");
	if (hasToken(prompt, "E2E_TEAM") || teamFail) {
		if (!toolResult(messages)) {
			return {
				tool: {
					name: "Team",
					args: {
						action: "create",
						subject: "E2E task",
						description: "prove the board",
						write_scopes: ["src/e2e"],
					},
				},
			};
		}
		const call = lastToolCall(messages);
		if (call?.name === "Team") {
			return {
				tool: {
					name: "Task",
					args: {
						description: "e2e team",
						subagent_type: "worker",
						prompt: teamFail ? "Claim task-1 E2E_TEAM_FAIL" : "Claim task-1",
						run_in_background: true,
					},
				},
			};
		}
		if (call?.name === "Task") return { text: "TEAM_STARTED" };
	}
	if (all.includes("E2E_STEER_TEXT") && toolResult(messages)) return { text: "STEER_APPLIED" };

	if (toolResult(messages)) {
		const call = lastToolCall(messages);
		if (call?.name === "TaskOutput") return { text: "LABELED" };
		if (call?.name === "TaskControl") return { text: "STEER_SENT" };
		if (call?.name === "bash" && String(call.args.command ?? "") === "sleep 1; true") {
			return {
				tool: {
					name: "TaskControl",
					args: { action: "stop", task_id: taskId(all) },
				},
			};
		}
		if (call?.name === "bash" && String(call.args.command ?? "").includes("sleep 1")) {
			return {
				tool: {
					name: "TaskControl",
					args: { action: "steer", task_id: taskId(all), text: "E2E_STEER_TEXT" },
				},
			};
		}
		if (call?.name === "Task" && call.args.run_in_background === true) {
			if (call.args.description === "e2e stop") {
				return { tool: { name: "bash", args: { command: "sleep 1; true" } } };
			}
			if (call.args.description === "e2e steer") {
				return { tool: { name: "bash", args: { command: "sleep 1" } } };
			}
			return { text: "PARENT_DONE" };
		}
		if (call?.name === "bash") return { text: "LONG_DONE" };
		if (Array.isArray(call?.args.chain)) return { text: "CHAIN_RAN" };
		if (Array.isArray(call?.args.parallel)) return { text: "PARALLEL_RAN" };
		if (call?.args.subagent_type === "e2e-slow") return { text: "ABORTED_RAN" };
		return { text: "TOOL_RAN" };
	}

	if (hasToken(prompt, "E2E_FAIL")) return { finish: "content_filter" };
	if (hasToken(prompt, "E2E_SLOW")) return { text: "SLOW_DONE", delayMs: 5000 };
	if (hasToken(prompt, "E2E_WAKE_CHILD")) return { text: "CHILD_REPORT", delayMs: 1200 };
	if (hasToken(prompt, "E2E_STOP")) {
		return {
			tool: {
				name: "Task",
				args: {
					description: "e2e stop",
					subagent_type: "e2e-slow",
					prompt: "E2E_SLOW",
					run_in_background: true,
				},
			},
		};
	}
	if (hasToken(prompt, "E2E_STEER_CHILD")) {
		return {
			tool: { name: "bash", args: { command: "sleep 5; echo STEER_READY" } },
		};
	}
	if (hasToken(prompt, "E2E_STEER")) {
		return {
			tool: {
				name: "Task",
				args: {
					description: "e2e steer",
					subagent_type: "e2e-long",
					prompt: "E2E_STEER_CHILD",
					run_in_background: true,
				},
			},
		};
	}
	if (hasToken(prompt, "E2E_RETRY")) {
		state.retry += 1;
		return state.retry === 1 ? { status: 429 } : { text: "RETRY_DONE" };
	}
	if (hasToken(prompt, "E2E_RETRY_PARENT")) {
		return {
			tool: {
				name: "Task",
				args: {
					description: "e2e retry",
					subagent_type: "e2e-a",
					prompt: "E2E_RETRY",
					run_in_background: true,
				},
			},
		};
	}
	if (hasToken(prompt, "E2E_WAKE")) {
		return {
			tool: {
				name: "Task",
				args: {
					description: "e2e wake",
					subagent_type: "e2e-a",
					prompt: "E2E_WAKE_CHILD",
					run_in_background: true,
				},
			},
		};
	}
	if (hasToken(prompt, "E2E_LONG")) {
		return {
			tool: {
				name: "bash",
				args: { command: "printf 'LONG line %s\\n' $(seq 1 40)" },
			},
		};
	}

	if (prompt.includes("STEP1")) return { text: "STEP2" };
	if (hasToken(prompt, "E2E_CHAIN_STEP")) return { text: "STEP1" };

	if (hasToken(all, "E2E_LABEL")) {
		return {
			tool: {
				name: "TaskOutput",
				args: { task_id: namedTask(prompt, all), failure: "spec" },
			},
		};
	}
	if (hasToken(prompt, "E2E_CHAIN")) {
		return {
			tool: {
				name: "Task",
				args: {
					description: "e2e chain",
					prompt: "E2E_CHAIN_STEP",
					chain: ["e2e-a", "e2e-b"],
				},
			},
		};
	}
	if (hasToken(prompt, "E2E_PARALLEL")) {
		return {
			tool: {
				name: "Task",
				args: {
					description: "e2e parallel",
					prompt: "E2E_PARALLEL_STEP",
					parallel: ["e2e-a", "e2e-b"],
				},
			},
		};
	}
	if (hasToken(prompt, "E2E_ABORT")) {
		return {
			tool: {
				name: "Task",
				args: {
					description: "e2e abort",
					subagent_type: "e2e-slow",
					prompt: "E2E_ABORT_STEP",
				},
			},
		};
	}
	return { text: "OKTOKEN" };
}

let chunkSeq = 0;

function chunk(delta: Record<string, unknown>, finish: string | null = null): string {
	chunkSeq += 1;
	return JSON.stringify({
		id: `chatcmpl-e2e-${chunkSeq}`,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: "e2e",
		choices: [{ index: 0, delta, finish_reason: finish }],
	});
}

function sse(res: ServerResponse, lines: string[]): void {
	res.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	for (const line of lines) res.write(`data: ${line}\n\n`);
	res.write("data: [DONE]\n\n");
	res.end();
}

async function bodyOf(req: IncomingMessage): Promise<unknown> {
	let raw = "";
	for await (const part of req) raw += part.toString();
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return {};
	}
}

export function startFakeProvider(opts: FakeProviderOptions = {}): Promise<FakeProvider> {
	const requests: FakeRequest[] = [];
	const state = { retry: 0 };
	const server = createServer(async (req, res) => {
		const path = req.url ?? "";
		if (req.method !== "POST" || !path.endsWith("/chat/completions")) {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("not found");
			return;
		}
		const body = await bodyOf(req);
		const messages = messagesOf(body);
		requests.push({
			at: Date.now(),
			path,
			body,
			prompt: lastUser(messages),
		});
		const answer = answerFor(messages, state, opts);
		const allText = messages.map((message) => textOf(message.content)).join("\n");
		if (
			allText.includes('[team] You are "') &&
			/E2E_MAIL_SEND|E2E_MAIL_WAIT|E2E_PING/.test(allText)
		)
			answer.delayMs ??= 150;
		const delay = answer.delayMs ?? opts.delayMs ?? 0;
		if (delay > 0) await sleep(delay);
		if (res.destroyed || res.writableEnded) return;
		if (answer.status) {
			res.writeHead(answer.status, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: "e2e failure", type: "server_error" } }));
			return;
		}
		if (answer.finish) {
			sse(res, [chunk({ role: "assistant", content: "" }), chunk({}, answer.finish)]);
			return;
		}
		if (answer.tool) {
			sse(res, [
				chunk({
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: `call_e2e_${chunkSeq}`,
							type: "function",
							function: {
								name: answer.tool.name,
								arguments: JSON.stringify(answer.tool.args),
							},
						},
					],
				}),
				chunk({}, "tool_calls"),
			]);
			return;
		}
		sse(res, [chunk({ role: "assistant", content: answer.text ?? "OKTOKEN" }), chunk({}, "stop")]);
	});

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address() as AddressInfo;
			resolve({
				baseUrl: `http://127.0.0.1:${address.port}/v1`,
				requests,
				close: () =>
					new Promise<void>((done) => {
						server.closeAllConnections?.();
						server.close(() => done());
					}),
			});
		});
	});
}
