/**
 * pi-subagents: live messages between team members.
 */

import { capDelivery } from "../domain/run-result.ts";
import type { MailResult, TeamMessageApi, WaitOutcome } from "../domain/team-mail.ts";
import { LEAD_NAME } from "../domain/team.ts";
import type { TaskRecord } from "../domain/task.ts";
import { journalWrite } from "../telemetry/journal.ts";
import type { TaskStore } from "./task-store.ts";
import { teamMembers } from "./team-store.ts";

export const MAX_MESSAGE_CHARS = 2_000;
export const MAX_COLD_MESSAGES = 8;
export const MAX_COLD_CHARS = 8_000;
export const MAX_WAIT_MS = 120_000;
export const TEAM_MESSAGE_CUSTOM_TYPE = "pi-subagents:team-message";

interface LiveMember {
	name: string;
	starter: string;
	runId?: string;
	chain?: boolean;
	steer: (text: string) => void;
}

interface WaitEdge {
	from: string;
	to: string;
}

const live = new Map<string, LiveMember>();
const waits = new Set<WaitEdge>();
const cold = new Map<string, string[]>();
let leadInbox: ((text: string) => void) | undefined;
let tasks: TaskStore | undefined;

export function bindTeamMail(store: TaskStore): void {
	tasks = store;
}

export function setLeadInbox(sink: ((text: string) => void) | undefined): void {
	leadInbox = sink;
}

export function clearTeamMail(): void {
	live.clear();
	waits.clear();
	cold.clear();
	leadInbox = undefined;
}

/** Bind one running child. The returned function removes only this binding. */
export function bindTeamMember(
	name: string,
	starter: string,
	steer: (text: string) => void,
	runId?: string,
	chain = false,
): () => void {
	const row: LiveMember = {
		name,
		starter,
		steer,
		...(runId ? { runId } : {}),
		...(chain ? { chain } : {}),
	};
	live.set(name, row);
	const queued = cold.get(name);
	if (queued) {
		cold.delete(name);
		for (const line of queued) steer(line);
	}
	return () => {
		if (live.get(name) === row) live.delete(name);
	};
}

export function liveMember(
	name: string,
): { name: string; starter: string; runId?: string } | undefined {
	const row = live.get(name);
	return row
		? { name: row.name, starter: row.starter, ...(row.runId ? { runId: row.runId } : {}) }
		: undefined;
}

function coldError(name: string): string {
	return teamMembers().some((row) => row.name === name)
		? `${name} is not running. Read its settle card or use TaskOutput.`
		: `No member named "${name}".`;
}

export function sendTeamMessage(from: string | undefined, to: string, text: string): MailResult {
	const sender = from?.trim() || LEAD_NAME;
	const target = to.trim();
	if (!target) return { ok: false, error: "A message needs a target." };
	if (target === sender) return { ok: false, error: "You cannot message yourself." };
	const clean = text.trim();
	if (!clean) return { ok: false, error: "A message needs text." };
	const body = clean.slice(0, MAX_MESSAGE_CHARS);
	const line = `[team message] from ${sender}: ${body}`;
	if (target === LEAD_NAME) {
		if (!leadInbox) return { ok: false, error: "The lead is not listening in this session." };
		leadInbox(line);
	} else {
		const member = live.get(target);
		if (member) {
			member.steer(line);
		} else {
			const known = teamMembers().some((row) => row.name === target);
			if (!known) return { ok: false, error: `No member named "${target}".` };
			const queue = cold.get(target) ?? [];
			const chars = queue.reduce((sum, item) => sum + item.length, 0);
			if (queue.length >= MAX_COLD_MESSAGES || chars + line.length > MAX_COLD_CHARS) {
				return {
					ok: false,
					error: `${target}'s inbox is full; read its settle card or TaskOutput.`,
				};
			}
			queue.push(line);
			cold.set(target, queue);
			journalWrite({
				event: "team_message",
				from: sender,
				to: target,
				chars: body.length,
				queued: true,
			});
			return {
				ok: true,
				chars: body.length,
				truncated: clean.length > MAX_MESSAGE_CHARS,
				queued: true,
			};
		}
	}
	journalWrite({ event: "team_message", from: sender, to: target, chars: body.length });
	return { ok: true, chars: body.length, truncated: clean.length > MAX_MESSAGE_CHARS };
}

function settled(row: TaskRecord): WaitOutcome | undefined {
	if (row.status === "running") return undefined;
	return {
		kind: "settled",
		taskId: row.taskId,
		status: row.status,
		report: capDelivery(row.result?.text ?? ""),
		...(row.error ? { error: row.error } : {}),
	};
}

function cyclePath(sender: string, target: string): string[] | undefined {
	const seen = new Set<string>();
	const walk = (node: string, path: string[]): string[] | undefined => {
		if (node === sender) return [...path, node];
		if (seen.has(node)) return undefined;
		seen.add(node);
		for (const edge of waits) {
			if (edge.from !== node) continue;
			const found = walk(edge.to, [...path, node]);
			if (found) return found;
		}
		return undefined;
	};
	return walk(target, [sender]);
}

function waitCycleError(sender: string, target: string, path: string[]): string {
	let next = sender;
	for (const edge of waits) {
		if (edge.from === target) {
			next = edge.to;
			break;
		}
	}
	return `${sender} cannot wait on ${target}: ${target} is already waiting on ${next} (deadlock: ${path.join(" -> ")}).`;
}

function coldWait(name: string): WaitOutcome {
	const known = teamMembers().find((row) => row.name === name);
	if (!known?.key || !tasks) return { kind: "failed", error: coldError(name) };
	const row = tasks.get(known.key);
	if (!row) return { kind: "failed", error: coldError(name) };
	const out = settled(row);
	if (out) return out;
	return { kind: "failed", error: `${name} has no live process; last row still running.` };
}

export async function waitForMember(
	from: string | undefined,
	to: string,
	timeoutMs = MAX_WAIT_MS,
): Promise<WaitOutcome> {
	const sender = from?.trim() || LEAD_NAME;
	const target = to.trim();
	if (!target) return { kind: "failed", error: "A wait needs a member name." };
	if (target === LEAD_NAME) return { kind: "failed", error: "The lead has no run row to wait on." };
	if (target === sender) return { kind: "failed", error: "You cannot wait on yourself." };
	const member = live.get(target);
	if (!member) return coldWait(target);
	if (member.chain)
		return {
			kind: "failed",
			error: `${target} runs inside a chain; wait is not available. Read the chain report when it settles.`,
		};
	if (!member.runId)
		return { kind: "failed", error: `${target} has no run row yet. Try TaskOutput.` };
	if (!tasks) return { kind: "failed", error: "The task store is not ready." };
	const store = tasks;
	const runId = member.runId;
	const first = store.get(runId);
	if (!first) return { kind: "failed", error: `${target} has no run row yet. Try TaskOutput.` };
	const done = settled(first);
	if (done) return done;
	const path = cyclePath(sender, target);
	if (path) return { kind: "failed", error: waitCycleError(sender, target, path) };
	const edge: WaitEdge = { from: sender, to: target };
	waits.add(edge);
	const waitMs = Math.min(Math.max(1, timeoutMs), MAX_WAIT_MS);
	const started = Date.now();
	return new Promise<WaitOutcome>((resolve) => {
		let finished = false;
		const finish = (out: WaitOutcome) => {
			if (finished) return;
			finished = true;
			waits.delete(edge);
			clearTimeout(timer);
			off();
			resolve(out);
		};
		const check = () => {
			const row = store.get(runId);
			const out = row ? settled(row) : undefined;
			if (out) finish(out);
		};
		const off = store.subscribe(check);
		const timer = setTimeout(
			() => finish({ kind: "running", taskId: runId, waitedMs: Date.now() - started }),
			waitMs,
		);
		check();
	});
}

export const teamMessageApi: TeamMessageApi = { send: sendTeamMessage, wait: waitForMember };
