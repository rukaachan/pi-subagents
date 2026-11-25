/**
 * pi-subagents: decoding the bounded memory rows on a persisted board.
 */

import {
	MAX_AGENT_TEAM_ATTEMPTS,
	MAX_AGENT_TEAM_ERROR,
	MAX_AGENT_TEAM_EXCLUDED,
	MAX_AGENT_TEAM_FACT,
	MAX_AGENT_TEAM_FACTS,
	type AgentTeamAttempt,
	type AgentTeamLedgerEntry,
	type AgentTeamLedgerKind,
} from "../../domain/agent-team/index.ts";

const OUTCOMES = new Set<AgentTeamAttempt["outcome"]>(["released", "failed", "passed"]);
const LEDGER_KINDS = new Set<AgentTeamLedgerKind>(["fact", "excluded"]);

export function stringValue(value: unknown, max: number): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

export function decodeAttempts(value: unknown): AgentTeamAttempt[] {
	if (!Array.isArray(value)) return [];
	const out: AgentTeamAttempt[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const row = item as Record<string, unknown>;
		const at = row.at;
		const outcome = row.outcome;
		if (typeof at !== "number" || !Number.isFinite(at)) continue;
		if (typeof outcome !== "string" || !OUTCOMES.has(outcome as AgentTeamAttempt["outcome"]))
			continue;
		const owner = stringValue(row.owner, 64);
		const error = stringValue(row.error, MAX_AGENT_TEAM_ERROR);
		out.push({
			at,
			outcome: outcome as AgentTeamAttempt["outcome"],
			...(owner ? { owner } : {}),
			...(error ? { error } : {}),
		});
	}
	if (out.length > MAX_AGENT_TEAM_ATTEMPTS) out.splice(0, out.length - MAX_AGENT_TEAM_ATTEMPTS);
	return out;
}

export function decodeLedger(value: unknown): AgentTeamLedgerEntry[] {
	if (!Array.isArray(value)) return [];
	const out: AgentTeamLedgerEntry[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const row = item as Record<string, unknown>;
		const text = stringValue(row.text, MAX_AGENT_TEAM_FACT);
		const taskId = stringValue(row.taskId, 64);
		const by = stringValue(row.by, 64);
		const at = row.at;
		const kind = row.kind;
		if (!text || !taskId || !/^task-[1-9]\d*$/.test(taskId) || !by) continue;
		if (typeof at !== "number" || !Number.isFinite(at)) continue;
		if (typeof kind !== "string" || !LEDGER_KINDS.has(kind as AgentTeamLedgerKind)) continue;
		const key = kind + ":" + text.replace(/\s+/g, " ").trim().toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ text, kind: kind as AgentTeamLedgerKind, taskId, by, at });
	}
	for (const kind of ["fact", "excluded"] as const) {
		const max = kind === "fact" ? MAX_AGENT_TEAM_FACTS : MAX_AGENT_TEAM_EXCLUDED;
		while (out.filter((entry) => entry.kind === kind).length > max) {
			const first = out.findIndex((entry) => entry.kind === kind);
			out.splice(first, 1);
		}
	}
	return out;
}
