/**
 * pi-subagents: validating the team board read from disk.
 */

import {
	MAX_AGENT_TEAM_ACCEPTANCE,
	MAX_AGENT_TEAM_BLOCKERS,
	MAX_AGENT_TEAM_DESCRIPTION,
	MAX_AGENT_TEAM_ERROR,
	MAX_AGENT_TEAM_MEMBERS,
	MAX_AGENT_TEAM_RESULT,
	MAX_AGENT_TEAM_RUN_ID,
	MAX_AGENT_TEAM_SCOPES,
	MAX_AGENT_TEAM_SUBJECT,
	MAX_AGENT_TEAM_TASKS,
	MAX_AGENT_TEAM_VERIFY_WITH,
	type AgentTeamLedgerEntry,
	type AgentTeamMember,
	type AgentTeamOrigin,
	type AgentTeamRole,
	type AgentTeamTask,
	type AgentTeamTaskStatus,
	type VerificationVerdict,
} from "../../domain/agent-team/index.ts";
import { canonicalWorkspacePath } from "../../domain/policy/index.ts";
import { MAX_COLD_CHARS, MAX_COLD_MESSAGES } from "../../domain/agent-team/index.ts";
import { decodeAttempts, decodeLedger, stringValue } from "./state-agent-team-rows.ts";

export interface PersistedAgentTeam {
	agentTeamId: string;
	enabled: boolean;
	nextId: number;
	tasks: AgentTeamTask[];
	members: AgentTeamMember[];
	ledger: AgentTeamLedgerEntry[];
	coldMail?: Record<string, string[]>;
}

const STATUSES = new Set<AgentTeamTaskStatus>([
	"pending",
	"in_progress",
	"in_review",
	"completed",
	"deleted",
]);
const ROLES = new Set<AgentTeamRole>(["worker", "verifier", "advisor"]);
const ORIGINS = new Set<AgentTeamOrigin>([
	"manual",
	"task",
	"parallel",
	"chain",
	"delegate",
	"finish",
	"start",
]);
const VERDICTS = new Set<VerificationVerdict>(["pass", "fail"]);
const MAX_PERSISTED_TASKS = MAX_AGENT_TEAM_TASKS * 2;

function stringList(value: unknown, max: number, each: number): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== "string" || !item || item.length > each) continue;
		if (!out.includes(item)) out.push(item);
		if (out.length >= max) break;
	}
	return out;
}

function decodeScopes(value: unknown): string[] {
	const out: string[] = [];
	for (const item of stringList(value, MAX_AGENT_TEAM_SCOPES, 160)) {
		const canonical = canonicalWorkspacePath(item);
		if (!canonical.ok || out.includes(canonical.path)) continue;
		out.push(canonical.path);
	}
	return out;
}

function decodeTask(value: unknown): AgentTeamTask | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const row = value as Record<string, unknown>;
	const id = stringValue(row.id, 64);
	const subject = stringValue(row.subject, MAX_AGENT_TEAM_SUBJECT);
	const revision = row.revision;
	const status = row.status;
	const createdAt = row.createdAt;
	const updatedAt = row.updatedAt;
	if (!id || !/^task-[1-9]\d*$/.test(id)) return undefined;
	if (!subject) return undefined;
	if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1)
		return undefined;
	if (typeof status !== "string" || !STATUSES.has(status as AgentTeamTaskStatus)) return undefined;
	if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return undefined;
	if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return undefined;
	const owner = stringValue(row.owner, 64);
	const lastOwner = stringValue(row.lastOwner, 64);
	const lastError = stringValue(row.lastError, MAX_AGENT_TEAM_ERROR);
	const runId = stringValue(row.runId, MAX_AGENT_TEAM_RUN_ID);
	const result =
		typeof row.result === "string" ? row.result.slice(0, MAX_AGENT_TEAM_RESULT) : undefined;
	const returnedAt =
		typeof row.returnedAt === "number" && Number.isFinite(row.returnedAt)
			? row.returnedAt
			: undefined;
	const acceptance = stringValue(row.acceptance, MAX_AGENT_TEAM_ACCEPTANCE);
	const verifyWith = stringValue(row.verifyWith, MAX_AGENT_TEAM_VERIFY_WITH);
	const verdict =
		typeof row.verdict === "string" && VERDICTS.has(row.verdict as VerificationVerdict)
			? (row.verdict as VerificationVerdict)
			: undefined;
	const verifiedBy = stringValue(row.verifiedBy, 64);
	const verifiedAt =
		typeof row.verifiedAt === "number" && Number.isFinite(row.verifiedAt)
			? row.verifiedAt
			: undefined;
	const verifyRunId = stringValue(row.verifyRunId, MAX_AGENT_TEAM_RUN_ID);
	const attempts = decodeAttempts(row.attempts);
	const origin =
		typeof row.origin === "string" && ORIGINS.has(row.origin as AgentTeamOrigin)
			? (row.origin as AgentTeamOrigin)
			: "manual";
	return {
		id,
		revision,
		subject,
		description:
			typeof row.description === "string"
				? row.description.slice(0, MAX_AGENT_TEAM_DESCRIPTION)
				: "",
		status: status as AgentTeamTaskStatus,
		...(owner ? { owner } : {}),
		...(lastOwner ? { lastOwner } : {}),
		...(lastError ? { lastError } : {}),
		...(returnedAt !== undefined ? { returnedAt } : {}),
		...(runId ? { runId } : {}),
		...(result ? { result } : {}),
		...(acceptance ? { acceptance } : {}),
		...(verifyWith ? { verifyWith } : {}),
		...(verdict ? { verdict } : {}),
		...(verifiedBy ? { verifiedBy } : {}),
		...(verifiedAt !== undefined ? { verifiedAt } : {}),
		...(verifyRunId ? { verifyRunId } : {}),
		...(attempts.length > 0 ? { attempts } : {}),
		origin,
		blockedBy: stringList(row.blockedBy, MAX_AGENT_TEAM_BLOCKERS, 64),
		writeScopes: decodeScopes(row.writeScopes),
		createdAt,
		updatedAt,
	};
}

function decodeMember(value: unknown): AgentTeamMember | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const row = value as Record<string, unknown>;
	const name = stringValue(row.name, 64);
	const starter = stringValue(row.starter, 64);
	const joinedAt = row.joinedAt;
	const key = stringValue(row.key, 128);
	const role =
		typeof row.role === "string" && ROLES.has(row.role as AgentTeamRole)
			? (row.role as AgentTeamRole)
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
		...(coldMail ? { coldMail } : {}),
	};
}
