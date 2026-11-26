/**
 * pi-subagents: decoding one team task read from disk.
 */

import {
	MAX_AGENT_TEAM_ACCEPTANCE,
	MAX_AGENT_TEAM_BLOCKERS,
	MAX_AGENT_TEAM_DESCRIPTION,
	MAX_AGENT_TEAM_ERROR,
	MAX_AGENT_TEAM_RESULT,
	MAX_AGENT_TEAM_ROUNDS,
	MAX_AGENT_TEAM_RUN_ID,
	MAX_AGENT_TEAM_SCOPES,
	MAX_AGENT_TEAM_SUBJECT,
	MAX_AGENT_TEAM_VERIFY_WITH,
	MAX_AGENT_TEAM_WORKTREE_PATH,
	type AgentTeamIsolation,
	type AgentTeamOrigin,
	type AgentTeamTask,
	type AgentTeamTaskStatus,
	type AgentTeamWorktree,
	type VerificationVerdict,
} from "../../domain/agent-team/index.ts";
import { canonicalWorkspacePath } from "../../domain/policy/index.ts";
import { decodeAttempts, stringList, stringValue } from "./rows/index.ts";

const STATUSES = new Set<AgentTeamTaskStatus>([
	"pending",
	"in_progress",
	"in_review",
	"completed",
	"deleted",
]);
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

function decodeScopes(value: unknown): string[] {
	const out: string[] = [];
	for (const item of stringList(value, MAX_AGENT_TEAM_SCOPES, 160)) {
		const canonical = canonicalWorkspacePath(item);
		if (!canonical.ok || out.includes(canonical.path)) continue;
		out.push(canonical.path);
	}
	return out;
}

function decodeWorktree(value: unknown): AgentTeamWorktree | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const row = value as Record<string, unknown>;
	const path = stringValue(row.path, MAX_AGENT_TEAM_WORKTREE_PATH);
	const base = stringValue(row.base, MAX_AGENT_TEAM_WORKTREE_PATH);
	const createdAt = row.createdAt;
	const mergedAt = row.mergedAt;
	if (!path || !base || typeof createdAt !== "number" || !Number.isFinite(createdAt))
		return undefined;
	return {
		path,
		base,
		createdAt,
		...(typeof mergedAt === "number" && Number.isFinite(mergedAt) ? { mergedAt } : {}),
	};
}

export function decodeTask(value: unknown): AgentTeamTask | undefined {
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
	const crossVerify = row.crossVerify === true;
	const crossVerdict =
		typeof row.crossVerdict === "string" && VERDICTS.has(row.crossVerdict as VerificationVerdict)
			? (row.crossVerdict as VerificationVerdict)
			: undefined;
	const crossVerifiedBy = stringValue(row.crossVerifiedBy, 64);
	const crossVerifiedAt =
		typeof row.crossVerifiedAt === "number" && Number.isFinite(row.crossVerifiedAt)
			? row.crossVerifiedAt
			: undefined;
	const crossVerifyRunId = stringValue(row.crossVerifyRunId, MAX_AGENT_TEAM_RUN_ID);
	const round =
		typeof row.round === "number" &&
		Number.isSafeInteger(row.round) &&
		row.round >= 1 &&
		row.round <= MAX_AGENT_TEAM_ROUNDS
			? row.round
			: undefined;
	const isolation: AgentTeamIsolation | undefined =
		row.isolation === "shared" || row.isolation === "worktree" ? row.isolation : undefined;
	const worktree = decodeWorktree(row.worktree);
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
		...(crossVerify ? { crossVerify } : {}),
		...(crossVerdict ? { crossVerdict } : {}),
		...(crossVerifiedBy ? { crossVerifiedBy } : {}),
		...(crossVerifiedAt !== undefined ? { crossVerifiedAt } : {}),
		...(crossVerifyRunId ? { crossVerifyRunId } : {}),
		...(round !== undefined ? { round } : {}),
		...(isolation ? { isolation } : {}),
		...(worktree ? { worktree } : {}),
		...(attempts.length > 0 ? { attempts } : {}),
		origin,
		blockedBy: stringList(row.blockedBy, MAX_AGENT_TEAM_BLOCKERS, 64),
		writeScopes: decodeScopes(row.writeScopes),
		createdAt,
		updatedAt,
	};
}
