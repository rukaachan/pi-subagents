/**
 * pi-subagents: validating the team board read from disk.
 */

import {
	MAX_TEAM_BLOCKERS,
	MAX_TEAM_DESCRIPTION,
	MAX_TEAM_ERROR,
	MAX_TEAM_MEMBERS,
	MAX_TEAM_SCOPES,
	MAX_TEAM_SUBJECT,
	MAX_TEAM_TASKS,
	type TeamMember,
	type TeamTask,
	type TeamTaskStatus,
} from "../domain/team.ts";

export interface PersistedTeam {
	teamId: string;
	enabled: boolean;
	nextId: number;
	tasks: TeamTask[];
	members: TeamMember[];
}

const STATUSES = new Set<TeamTaskStatus>(["pending", "in_progress", "completed", "deleted"]);
const MAX_PERSISTED_TASKS = MAX_TEAM_TASKS * 2;

function stringValue(value: unknown, max: number): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

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

function decodeTask(value: unknown): TeamTask | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const row = value as Record<string, unknown>;
	const id = stringValue(row.id, 64);
	const subject = stringValue(row.subject, MAX_TEAM_SUBJECT);
	const revision = row.revision;
	const status = row.status;
	const createdAt = row.createdAt;
	const updatedAt = row.updatedAt;
	if (!id || !/^task-[1-9]\d*$/.test(id)) return undefined;
	if (!subject) return undefined;
	if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1)
		return undefined;
	if (typeof status !== "string" || !STATUSES.has(status as TeamTaskStatus)) return undefined;
	if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return undefined;
	if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return undefined;
	const owner = stringValue(row.owner, 64);
	const lastOwner = stringValue(row.lastOwner, 64);
	const lastError = stringValue(row.lastError, MAX_TEAM_ERROR);
	const returnedAt =
		typeof row.returnedAt === "number" && Number.isFinite(row.returnedAt)
			? row.returnedAt
			: undefined;
	return {
		id,
		revision,
		subject,
		description:
			typeof row.description === "string" ? row.description.slice(0, MAX_TEAM_DESCRIPTION) : "",
		status: status as TeamTaskStatus,
		...(owner ? { owner } : {}),
		...(lastOwner ? { lastOwner } : {}),
		...(lastError ? { lastError } : {}),
		...(returnedAt !== undefined ? { returnedAt } : {}),
		blockedBy: stringList(row.blockedBy, MAX_TEAM_BLOCKERS, 64),
		writeScopes: stringList(row.writeScopes, MAX_TEAM_SCOPES, 160),
		createdAt,
		updatedAt,
	};
}

function decodeMember(value: unknown): TeamMember | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const row = value as Record<string, unknown>;
	const name = stringValue(row.name, 64);
	const starter = stringValue(row.starter, 64);
	const joinedAt = row.joinedAt;
	const key = stringValue(row.key, 128);
	if (!name || !starter) return undefined;
	if (typeof joinedAt !== "number" || !Number.isFinite(joinedAt)) return undefined;
	return { name, starter, joinedAt, ...(key ? { key } : {}) };
}

function highestId(tasks: readonly TeamTask[]): number {
	let max = 0;
	for (const task of tasks) {
		const n = Number(task.id.slice(5));
		if (Number.isSafeInteger(n) && n > max) max = n;
	}
	return max;
}

/** Rebuild a board field by field; drop malformed rows instead of casting. */
export function decodeTeam(value: unknown): PersistedTeam | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const row = value as Record<string, unknown>;
	const teamId = stringValue(row.teamId, 128);
	if (!teamId) return undefined;
	const tasks: TeamTask[] = [];
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
	const members: TeamMember[] = [];
	const names = new Set<string>();
	if (Array.isArray(row.members)) {
		for (const item of row.members) {
			const member = decodeMember(item);
			if (!member || names.has(member.name)) continue;
			names.add(member.name);
			members.push(member);
			if (members.length >= MAX_TEAM_MEMBERS) break;
		}
	}
	const stored = row.nextId;
	const nextId =
		typeof stored === "number" && Number.isSafeInteger(stored) && stored > 0
			? Math.max(stored, highestId(tasks) + 1)
			: highestId(tasks) + 1;
	return { teamId, enabled: row.enabled === true, nextId, tasks, members };
}
