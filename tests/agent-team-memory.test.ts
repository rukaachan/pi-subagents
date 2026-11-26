import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	MAX_AGENT_TEAM_EXCLUDED,
	MAX_AGENT_TEAM_FACTS,
	ledgerCounts,
	ledgerPrompt,
	newAgentTeam,
	recordAgentTeamAttempt,
	recordAgentTeamLedgerEntry,
} from "../src/domain/agent-team/index.ts";
import { createAgentTeamTask } from "../src/domain/team-tasks/index.ts";

function boardWithTask() {
	const board = newAgentTeam("s-memory");
	const created = createAgentTeamTask(board, { subject: "one", description: "" }, 1);
	assert.ok(created.ok);
	return { board, task: created.task };
}

describe("agent team memory", () => {
	it("keeps only the five newest attempts", () => {
		const { task } = boardWithTask();
		for (let at = 1; at <= 7; at += 1) {
			recordAgentTeamAttempt(task, {
				at,
				outcome: at === 7 ? "passed" : "failed",
				...(at === 7 ? {} : { error: "try " + at }),
			});
		}
		assert.equal(task.attempts?.length, 5);
		assert.equal(task.attempts?.[0]?.at, 3);
		assert.equal(task.attempts?.at(-1)?.outcome, "passed");
	});

	it("dedupes facts and keeps the newest per kind", () => {
		const { board } = boardWithTask();
		recordAgentTeamLedgerEntry(
			board,
			{
				text: "Parser reads UTF-8",
				kind: "fact",
				taskId: "task-1",
				by: "verifier",
			},
			2,
		);
		recordAgentTeamLedgerEntry(
			board,
			{
				text: "  parser reads utf-8 ",
				kind: "fact",
				taskId: "task-1",
				by: "verifier",
			},
			3,
		);
		assert.equal(board.ledger.length, 1);
		assert.equal(board.ledger[0]?.at, 2);
		for (let n = 0; n < MAX_AGENT_TEAM_FACTS + 5; n += 1) {
			recordAgentTeamLedgerEntry(
				board,
				{
					text: "fact " + n,
					kind: "fact",
					taskId: "task-1",
					by: "verifier",
				},
				n + 10,
			);
		}
		for (let n = 0; n < MAX_AGENT_TEAM_EXCLUDED + 5; n += 1) {
			recordAgentTeamLedgerEntry(
				board,
				{
					text: "dead " + n,
					kind: "excluded",
					taskId: "task-1",
					by: "verifier",
				},
				n + 10,
			);
		}
		assert.deepEqual(ledgerCounts(board), {
			facts: MAX_AGENT_TEAM_FACTS,
			excluded: MAX_AGENT_TEAM_EXCLUDED,
		});
		assert.equal(
			board.ledger.find((entry) => entry.text === "Parser reads UTF-8"),
			undefined,
		);
	});

	it("writes a bounded prompt with the newest facts and dead ends", () => {
		const { board } = boardWithTask();
		for (let n = 0; n < 10; n += 1) {
			recordAgentTeamLedgerEntry(
				board,
				{
					text: "fact " + n + ": " + "x".repeat(120),
					kind: "fact",
					taskId: "task-" + (n + 1),
					by: "verifier",
				},
				n + 1,
			);
		}
		recordAgentTeamLedgerEntry(
			board,
			{
				text: "glob ignores dotfiles",
				kind: "excluded",
				taskId: "task-9",
				by: "verifier",
			},
			20,
		);
		const prompt = ledgerPrompt(board);
		assert.match(prompt, /Verified facts/);
		assert.match(prompt, /Dead ends/);
		assert.match(prompt, /glob ignores dotfiles/);
		assert.match(prompt, /fact 9:/);
		assert.doesNotMatch(prompt, /fact 0:/);
		assert.ok(prompt.length <= 1_500);
	});

	it("keeps the method and round on an attempt", () => {
		const { task } = boardWithTask();
		task.round = 3;
		recordAgentTeamAttempt(task, {
			at: 1,
			outcome: "failed",
			error: "boom",
			method: "  try A  ",
			round: 3,
		});
		recordAgentTeamAttempt(task, {
			at: 2,
			outcome: "passed",
			method: "m".repeat(400),
			round: 0,
		});
		assert.equal(task.attempts?.[0]?.method, "try A");
		assert.equal(task.attempts?.[0]?.round, 3);
		assert.equal(task.attempts?.[1]?.method?.length, 300);
		assert.equal(task.attempts?.[1]?.round, undefined);
	});
});
