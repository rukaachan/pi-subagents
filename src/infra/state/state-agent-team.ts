/**
 * pi-subagents: validating the team board read from disk.
 */

import {
	DEFAULT_ROUND_MS,
	DEFAULT_ROUND_TOKENS,
	MAX_AGENT_TEAM_BRIEF,
	MAX_AGENT_TEAM_DESCRIPTION,
	MAX_AGENT_TEAM_MEMBERS,
	MAX_AGENT_TEAM_ROUNDS,
	MAX_AGENT_TEAM_ROUND_LEGS,
	MAX_AGENT_TEAM_TASKS,
	MAX_COLD_CHARS,
	MAX_COLD_MESSAGES,
	MAX_ROUND_MS,
	MAX_ROUND_TOKENS,
	type AgentTeamLedgerEntry,
	type AgentTeamMember,
	type AgentTeamRound,
	type AgentTeamTask,
} from "../../domain/agent-team/index.ts";
import { decodeLedger, stringList, stringValue } from "./rows/index.ts";
import { decodeTask } from "./state-agent-team-task.ts";

export interface PersistedAgentTeam {
	agentTeamId: string;
	enabled: boolean;
	nextId: number;
	tasks: AgentTeamTask[];
	members: AgentTeamMember[];
	ledger: AgentTeamLedgerEntry[];
	rounds: AgentTeamRound[];
	coldMail?: Record<string, string[]>;
}

const MAX_PERSISTED_TASKS = MAX_AGENT_TEAM_TASKS * 2;

function decodeMember(value: unknown): AgentTeamMember | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const row = value as Record<string, unknown>;
	const name = stringValue(row.name, 64);
	const starter = stringValue(row.starter, 64);
	const joinedAt = row.joinedAt;
	const key = stringValue(row.key, 128);
	const role =
		row.role === "worker" || row.role === "verifier" || row.role === "advisor"
			? row.role
			: "worker";
	if (!name || !starter) return undefined;
	if (typeof joinedAt !== "number" || !Number.isFinite(joinedAt)) return undefined;
	return { name, starter, role, joinedAt, ...(key ? { key } : {}) };
}

function decodeColdMail(
	value: unknown,
	names: ReadonlySet<string>,
): Record<string, string[]> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const row = value as Record<string, unknown>;
	const out: Record<string, string[]> = {};
	for (const [name, queue] of Object.entries(row)) {
		if (!names.has(name) || !Array.isArray(queue)) continue;
		const kept: string[] = [];
		let chars = 0;
		for (const item of queue) {
			if (typeof item !== "string" || !item) continue;
			if (kept.length >= MAX_COLD_MESSAGES || chars + item.length > MAX_COLD_CHARS) break;
			kept.push(item);
			chars += item.length;
		}
		if (kept.length > 0) out[name] = kept;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function decodeBudget(value: unknown): { tokens: number; ms: number } {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { tokens: DEFAULT_ROUND_TOKENS, ms: DEFAULT_ROUND_MS };
	}
	const row = value as Record<string, unknown>;
	const tokens =
		typeof row.tokens === "number" && Number.isFinite(row.tokens) && row.tokens > 0
			? Math.min(Math.floor(row.tokens), MAX_ROUND_TOKENS)
			: DEFAULT_ROUND_TOKENS;
	const ms =
		typeof row.ms === "number" && Number.isFinite(row.ms) && row.ms > 0
			? Math.min(Math.floor(row.ms), MAX_ROUND_MS)
			: DEFAULT_ROUND_MS;
	return { tokens, ms };
}

function decodeRounds(value: unknown): AgentTeamRound[] {
	if (!Array.isArray(value)) return [];
	const out: AgentTeamRound[] = [];
	const seen = new Set<number>();
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const row = item as Record<string, unknown>;
		const id = row.id;
		if (
			typeof id !== "number" ||
			!Number.isSafeInteger(id) ||
			id < 1 ||
			id > MAX_AGENT_TEAM_ROUNDS ||
			seen.has(id)
		)
			continue;
		const prompt = stringValue(row.prompt, MAX_AGENT_TEAM_DESCRIPTION);
		const startedAt = row.startedAt;
		if (!prompt || typeof startedAt !== "number" || !Number.isFinite(startedAt)) continue;
		const brief = stringValue(row.brief, MAX_AGENT_TEAM_BRIEF);
		seen.add(id);
		out.push({
			id,
			prompt,
			taskIds: stringList(row.taskIds, MAX_AGENT_TEAM_ROUND_LEGS, 64),
			...(brief ? { brief } : {}),
			budget: decodeBudget(row.budget),
			startedAt,
		});
	}
	out.sort((a, b) => a.id - b.id);
	if (out.length > MAX_AGENT_TEAM_ROUNDS) out.splice(0, out.length - MAX_AGENT_TEAM_ROUNDS);
	return out;
}

function highestId(tasks: readonly AgentTeamTask[]): number {
	let max = 0;
	for (const task of tasks) {
		const n = Number(task.id.slice(5));
		if (Number.isSafeInteger(n) && n > max) max = n;
	}
	return max;
}

/** Rebuild a board field by field; drop malformed rows instead of casting. */
export function decodeAgentTeam(value: unknown): PersistedAgentTeam | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const row = value as Record<string, unknown>;
	const agentTeamId = stringValue(row.agentTeamId ?? row.teamId, 128);
	if (!agentTeamId) return undefined;
	const tasks: AgentTeamTask[] = [];
	const ids = new Set<string>();
	if (Array.isArray(row.tasks)) {
		for (const item of row.tasks) {
			const task = decodeTask(item);
			if (!task || ids.has(task.id)) continue;
			ids.add(task.id);
			tasks.push(task);
			if (tasks.length >= MAX_PERSISTED_TASKS) break;
		}
	}
	const members: AgentTeamMember[] = [];
	const names = new Set<string>();
	if (Array.isArray(row.members)) {
		for (const item of row.members) {
			const member = decodeMember(item);
			if (!member || names.has(member.name)) continue;
			names.add(member.name);
			members.push(member);
			if (members.length >= MAX_AGENT_TEAM_MEMBERS) break;
		}
	}
	const stored = row.nextId;
	const nextId =
		typeof stored === "number" && Number.isSafeInteger(stored) && stored > 0
			? Math.max(stored, highestId(tasks) + 1)
			: highestId(tasks) + 1;
	const coldMail = decodeColdMail(row.coldMail, names);
	return {
		agentTeamId,
		enabled: row.enabled === true,
		nextId,
		tasks,
		members,
		ledger: decodeLedger(row.ledger),
		rounds: decodeRounds(row.rounds),
		...(coldMail ? { coldMail } : {}),
	};
}
