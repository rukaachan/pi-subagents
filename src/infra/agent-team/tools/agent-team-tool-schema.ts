/**
 * pi-subagents: the AgentTeam tool schema.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { MAX_AGENT_TEAM_TASKS } from "../../../domain/agent-team/index.ts";

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
		],
		{
			description:
				"Start an agent team (prompt required), read the board, create or change one task, verify a review, ask the advisor, or resolve a conflict.",
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
	verdict: Type.Optional(StringEnum(["pass", "fail"], { description: "Review verdict (verify)." })),
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
	question: Type.Optional(Type.String({ description: "Question for the advisor (advise)." })),
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
			description: "Subagents to start (start); empty means every discovered subagent.",
		}),
	),
});

type Params = {
	action:
		| "start"
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
		| "advise";
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
	verdict?: "pass" | "fail";
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
};

export { PARAMETERS, UPDATE_ACTIONS };
export type { Params };
