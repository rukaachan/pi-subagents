/**
 * pi-subagents: live messages between team members.
 */

import { MAX_COLD_CHARS, MAX_COLD_MESSAGES } from "../../../domain/team/index.ts";
import type { MailResult, TeamMessageApi, WaitOutcome } from "../../../domain/team/index.ts";
import { LEAD_NAME } from "../../../domain/team/index.ts";
import { journalWrite } from "../../../telemetry/journal/index.ts";
import type { TaskStore } from "../../../domain/task/index.ts";
import { teamMembers } from "../board/index.ts";
import { clearWaits, MAX_WAIT_MS, waitForMemberCore } from "./team-wait.ts";

export { MAX_WAIT_MS };

export const MAX_MESSAGE_CHARS = 2_000;
export { MAX_COLD_CHARS, MAX_COLD_MESSAGES };
export const TEAM_MESSAGE_CUSTOM_TYPE = "pi-subagents:team-message";

interface LiveMember {
	name: string;
	starter: string;
	runId?: string;
	chain?: boolean;
	steer: (text: string) => void;
}

const live = new Map<string, LiveMember>();
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
	clearWaits();
	cold.clear();
	leadInbox = undefined;
}

/** The cold queues as they go to disk; undefined when nothing waits. */
export function coldMailSnapshot(): Record<string, string[]> | undefined {
	if (cold.size === 0) return undefined;
	const out: Record<string, string[]> = {};
	for (const [name, queue] of cold) {
		if (queue.length > 0) out[name] = [...queue];
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/** Restore only known members and keep the existing count/char bounds. */
export function restoreColdMail(mail: Record<string, string[]> | undefined): void {
	cold.clear();
	if (!mail) return;
	const known = new Set(teamMembers().map((member) => member.name));
	for (const [name, queue] of Object.entries(mail)) {
		if (!known.has(name) || !Array.isArray(queue)) continue;
		const kept: string[] = [];
		let chars = 0;
		for (const line of queue) {
			if (typeof line !== "string" || !line) continue;
			if (kept.length >= MAX_COLD_MESSAGES || chars + line.length > MAX_COLD_CHARS) break;
			kept.push(line);
			chars += line.length;
		}
		if (kept.length > 0) cold.set(name, kept);
	}
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
		tasks?.touch();
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
			tasks?.touch();
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

export function waitForMember(
	from: string | undefined,
	to: string,
	timeoutMs = MAX_WAIT_MS,
): Promise<WaitOutcome> {
	return waitForMemberCore(
		from,
		to,
		{ target: live.get(to.trim()), tasks, members: teamMembers },
		timeoutMs,
	);
}

export const teamMessageApi: TeamMessageApi = { send: sendTeamMessage, wait: waitForMember };
