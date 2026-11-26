/**
 * pi-subagents: turn one finished task into a starter subagent draft.
 */

import { MAX_AGENT_TEAM_PROMOTE, type AgentTeamBoard, type AgentTeamTask } from "../index.ts";

export interface PromoteDraft {
	name: string;
	content: string;
}

function fail(error: string): { ok: false; error: string } {
	return { ok: false, error };
}

function slug(value: string): string {
	const raw = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32);
	if (!raw) return "agent-team-task";
	if (/^[a-z]/.test(raw) && raw.length >= 2) return raw;
	return `task-${raw}`.slice(0, 32);
}

function oneLine(value: string, max = 200): string {
	const line = value.replace(/\s+/g, " ").trim();
	return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

function cut(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function methods(task: AgentTeamTask): string[] {
	const rows = (task.attempts ?? []).slice(-5).map((attempt) => {
		const round = attempt.round !== undefined ? `round ${attempt.round} · ` : "";
		const method = attempt.method ? oneLine(attempt.method, 180) : attempt.outcome;
		return `- ${round}${method}`;
	});
	return rows;
}

function deadEnds(board: AgentTeamBoard, taskId: string): string[] {
	return board.ledger
		.filter((row) => row.kind === "excluded" && row.taskId === taskId)
		.slice(-5)
		.map((row) => `- ${oneLine(row.text, 180)}`);
}

export function buildPromoteDraft(
	task: AgentTeamTask,
	board: AgentTeamBoard,
): { ok: true; draft: PromoteDraft } | { ok: false; error: string } {
	if (task.status !== "completed") {
		return fail("Promote needs a completed task.");
	}
	if (task.verdict !== "pass") return fail("Promote needs a passing verifier verdict.");
	if (task.crossVerify && task.crossVerdict !== "pass") {
		return fail("Promote needs the cross verifier to pass too.");
	}
	const name = slug(task.subject);
	const description = oneLine(task.description || task.subject, 180);
	const lines = [
		"---",
		`name: ${name}`,
		`description: ${JSON.stringify(description)}`,
		"model: inherit",
		"tools: read, grep, find, ls",
		"autonomy: low",
		"---",
		"",
		`# ${task.subject}`,
		"",
		"## Use when",
		task.description || task.subject,
	];
	if (task.acceptance) lines.push("", "## Acceptance", task.acceptance);
	const steps = methods(task);
	if (steps.length > 0) lines.push("", "## Steps", ...steps);
	const ends = deadEnds(board, task.id);
	if (ends.length > 0) lines.push("", "## Dead ends", ...ends);
	if (task.result) lines.push("", "## Proof", cut(task.result, 1_200));
	if (task.verdict) {
		lines.push(
			"",
			"## Verdict",
			`verified by ${task.verifiedBy ?? "verifier"}${task.crossVerifiedBy ? `; cross-checked by ${task.crossVerifiedBy}` : ""}`,
		);
	}
	return { ok: true, draft: { name, content: cut(lines.join("\n"), MAX_AGENT_TEAM_PROMOTE) } };
}
