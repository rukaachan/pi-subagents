/**
 * pi-subagents: durable team memory: attempt history, facts, and dead ends.
 */

import {
	MAX_AGENT_TEAM_ATTEMPTS,
	MAX_AGENT_TEAM_ERROR,
	MAX_AGENT_TEAM_EXCLUDED,
	MAX_AGENT_TEAM_FACT,
	MAX_AGENT_TEAM_FACTS,
	type AgentTeamBoard,
	type AgentTeamLedgerKind,
	type AgentTeamTask,
} from "./agent-team.ts";

export interface AgentTeamAttemptInput {
	at: number;
	owner?: string;
	outcome: AgentTeamAttemptOutcome;
	error?: string;
}

export type AgentTeamAttemptOutcome = "released" | "failed" | "passed";

const PROMPT_FACTS = 8;
const PROMPT_EXCLUDED = 4;
const PROMPT_CHARS = 1_500;

function clean(text: string): string {
	return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Keep only the newest attempts so a stuck task cannot grow without a bound. */
export function recordAgentTeamAttempt(task: AgentTeamTask, input: AgentTeamAttemptInput): void {
	const attempts = task.attempts ?? [];
	attempts.push({
		at: input.at,
		outcome: input.outcome,
		...(input.owner ? { owner: input.owner } : {}),
		...(input.error ? { error: input.error.slice(0, MAX_AGENT_TEAM_ERROR) } : {}),
	});
	if (attempts.length > MAX_AGENT_TEAM_ATTEMPTS) {
		attempts.splice(0, attempts.length - MAX_AGENT_TEAM_ATTEMPTS);
	}
	task.attempts = attempts;
}

/** Add one verified fact or dead end; duplicates and the oldest rows drop out. */
export function recordAgentTeamLedgerEntry(
	board: AgentTeamBoard,
	input: {
		text: string;
		kind: AgentTeamLedgerKind;
		taskId: string;
		by: string;
	},
	now: number,
): void {
	const text = input.text.trim().slice(0, MAX_AGENT_TEAM_FACT);
	if (!text) return;
	const key = clean(text);
	if (board.ledger.some((entry) => entry.kind === input.kind && clean(entry.text) === key)) return;
	board.ledger.push({
		text,
		kind: input.kind,
		taskId: input.taskId,
		by: input.by.slice(0, 64),
		at: now,
	});
	const max = input.kind === "fact" ? MAX_AGENT_TEAM_FACTS : MAX_AGENT_TEAM_EXCLUDED;
	while (board.ledger.filter((entry) => entry.kind === input.kind).length > max) {
		const oldest = board.ledger.findIndex((entry) => entry.kind === input.kind);
		board.ledger.splice(oldest, 1);
	}
}

export function ledgerCounts(board: AgentTeamBoard): { facts: number; excluded: number } {
	return {
		facts: board.ledger.filter((entry) => entry.kind === "fact").length,
		excluded: board.ledger.filter((entry) => entry.kind === "excluded").length,
	};
}

function addLine(lines: string[], line: string, state: { chars: number }): boolean {
	if (state.chars + line.length + 1 > PROMPT_CHARS) return false;
	lines.push(line);
	state.chars += line.length + 1;
	return true;
}

/** The newest facts and dead ends, sized to fit one prompt block. */
export function ledgerPrompt(board: AgentTeamBoard): string {
	const facts = board.ledger
		.filter((entry) => entry.kind === "fact")
		.slice(-PROMPT_FACTS)
		.toReversed();
	const excluded = board.ledger
		.filter((entry) => entry.kind === "excluded")
		.slice(-PROMPT_EXCLUDED)
		.toReversed();
	const lines: string[] = [];
	const state = { chars: 0 };
	if (facts.length > 0) {
		addLine(lines, "[agent-team] Verified facts (reuse; do not re-prove):", state);
		for (const entry of facts) {
			if (!addLine(lines, "- " + entry.taskId + ": " + entry.text, state)) break;
		}
	}
	if (excluded.length > 0) {
		addLine(lines, "[agent-team] Dead ends (do not repeat):", state);
		for (const entry of excluded) {
			if (!addLine(lines, "- " + entry.taskId + ": " + entry.text, state)) break;
		}
	}
	return lines.join("\n");
}
