/**
 * pi-subagents: the AgentTeam tool schema.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
	MAX_AGENT_TEAM_TASKS,
	MAX_ROUND_MS,
	MAX_ROUND_TOKENS,
} from "../../../domain/agent-team/index.ts";

const UPDATE_ACTIONS = new Set<string>([
	"claim",
	"release",
	"edit",
	"complete",
	"reopen",
	"reassign",
	"delete",
	"verify",
]);

const PARAMETERS = Type.Object({
	action: StringEnum(
		[
			"start",
			"round",
			"status",
			"list",
			"get",
			"resolve",
			"create",
			"claim",
			"release",
			"edit",
			"complete",
			"reopen",
			"reassign",
			"delete",
			"verify",
			"advise",
			"brief",
			"worktree",
			"promote",
		],
		{
			description:
				"Start an agent team or one bounded round (prompt required), read the board, create or change one task, verify a review, ask the advisor, request a round brief, or resolve a conflict.",
		},
	),
	task_id: Type.Optional(
		Type.String({ description: "Shared task id, e.g. task-1 (get, resolve, or change)." }),
	),
	expected_revision: Type.Optional(
		Type.Integer({
			minimum: 0,
			description: "Revision read from status/get/list (every change).",
		}),
	),
	subject: Type.Optional(Type.String({ description: "Task title (create or edit)." })),
	description: Type.Optional(
		Type.String({ description: "Details and acceptance criteria (create or edit)." }),
	),
	blocked_by: Type.Optional(
		Type.Array(Type.String(), {
			description: "Task ids that must complete first (create or edit); empty clears it.",
		}),
	),
	write_scopes: Type.Optional(
		Type.Array(Type.String(), {
			description: "Workspace-relative prefixes this task reserves (create or edit).",
		}),
	),
	owner: Type.Optional(
		Type.String({
			description: "Member to assign (lead-only reassign); empty unassigns.",
		}),
	),
	result: Type.Optional(
		Type.String({ description: "What the work returned (complete); trimmed and capped." }),
	),
	acceptance: Type.Optional(
		Type.String({ description: "Criteria a verifier checks (create or edit)." }),
	),
	verify_with: Type.Optional(
		Type.String({ description: "Subagent used for verification (create or edit)." }),
	),
	isolation: Type.Optional(
		StringEnum(["shared", "worktree"], {
			description: "Give each leg its own git worktree (start, round, create, edit).",
		}),
	),
	cross_verify: Type.Optional(
		Type.Boolean({
			description: "Opt in to the second reader; needs acceptance (create or edit).",
		}),
	),
	verdict: Type.Optional(StringEnum(["pass", "fail"], { description: "Review verdict (verify)." })),
	scope: Type.Optional(
		StringEnum(["task", "cross"], { description: "Task or cross-task verification (verify)." }),
	),
	note: Type.Optional(
		Type.String({ description: "Verification reason (verify) or release reason." }),
	),
	fact: Type.Optional(
		Type.String({ description: "One checked fact to keep on a passing verify (verify pass)." }),
	),
	excluded: Type.Optional(
		Type.String({ description: "One dead end to keep on a failing verify (verify fail)." }),
	),
	override: Type.Optional(
		Type.Boolean({ description: "Lead-only verification override; a note is required." }),
	),
	confirm: Type.Optional(
		Type.Boolean({ description: "Write the draft instead of previewing it (promote)." }),
	),
	worktree_action: Type.Optional(
		StringEnum(["status", "merged", "remove"], {
			description: "Read, retire a clean worktree, or force-remove one (worktree).",
		}),
	),
	question: Type.Optional(
		Type.String({ description: "Question for the advisor (advise) or brief." }),
	),
	status: Type.Optional(
		StringEnum(["pending", "in_progress", "in_review", "completed"], {
			description: "Exact status filter (list).",
		}),
	),
	unowned: Type.Optional(Type.Boolean({ description: "Filter by no owner (list)." })),
	ready: Type.Optional(Type.Boolean({ description: "Filter by claimable readiness (list)." })),
	limit: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: MAX_AGENT_TEAM_TASKS,
			description: "Rows to return (list).",
		}),
	),
	prompt: Type.Optional(Type.String({ description: "Shared task text (start); required." })),
	roster: Type.Optional(
		Type.Array(Type.String(), {
			description: "Subagents to start (start or round); empty means every discovered subagent.",
		}),
	),
	budget_tokens: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: MAX_ROUND_TOKENS,
			description: "Token budget for one round (round).",
		}),
	),
	budget_minutes: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: MAX_ROUND_MS / 60_000,
			description: "Wall-clock budget in minutes for one round (round).",
		}),
	),
	brief: Type.Optional(
		Type.String({ description: "Brief prepended to every leg prompt (round)." }),
	),
	directions: Type.Optional(
		Type.Array(Type.String(), { description: "One prompt per roster leg (round)." }),
	),
	force: Type.Optional(
		Type.Boolean({
			description: "Open a round past the previous round's budget (round).",
		}),
	),
});

type Params = {
	action:
		| "start"
		| "round"
		| "status"
		| "list"
		| "get"
		| "resolve"
		| "create"
		| "claim"
		| "release"
		| "edit"
		| "complete"
		| "reopen"
		| "reassign"
		| "delete"
		| "verify"
		| "advise"
		| "brief"
		| "worktree"
		| "promote";
	task_id?: string;
	expected_revision?: number;
	subject?: string;
	description?: string;
	blocked_by?: string[];
	write_scopes?: string[];
	owner?: string;
	result?: string;
	acceptance?: string;
	verify_with?: string;
	cross_verify?: boolean;
	isolation?: "shared" | "worktree";
	worktree_action?: "status" | "merged" | "remove";
	confirm?: boolean;
	verdict?: "pass" | "fail";
	scope?: "task" | "cross";
	note?: string;
	fact?: string;
	excluded?: string;
	override?: boolean;
	question?: string;
	status?: "pending" | "in_progress" | "in_review" | "completed";
	unowned?: boolean;
	ready?: boolean;
	limit?: number;
	prompt?: string;
	roster?: string[];
	budget_tokens?: number;
	budget_minutes?: number;
	brief?: string;
	directions?: string[];
	force?: boolean;
};

export { PARAMETERS, UPDATE_ACTIONS };
export type { Params };
