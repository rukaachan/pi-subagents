/**
 * pi-subagents: the Team tool schema.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { MAX_TEAM_TASKS } from "../domain/team/index.ts";

const UPDATE_ACTIONS = new Set<string>([
	"claim",
	"release",
	"edit",
	"complete",
	"reopen",
	"reassign",
	"delete",
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
		],
		{
			description:
				"Start a team (prompt required), read the board, create or change one task, or resolve a conflict.",
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
	status: Type.Optional(
		StringEnum(["pending", "in_progress", "completed"], {
			description: "Exact status filter (list).",
		}),
	),
	unowned: Type.Optional(Type.Boolean({ description: "Filter by no owner (list)." })),
	ready: Type.Optional(Type.Boolean({ description: "Filter by claimable readiness (list)." })),
	limit: Type.Optional(
		Type.Integer({ minimum: 1, maximum: MAX_TEAM_TASKS, description: "Rows to return (list)." }),
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
		| "delete";
	task_id?: string;
	expected_revision?: number;
	subject?: string;
	description?: string;
	blocked_by?: string[];
	write_scopes?: string[];
	owner?: string;
	result?: string;
	status?: "pending" | "in_progress" | "completed";
	unowned?: boolean;
	ready?: boolean;
	limit?: number;
	prompt?: string;
	roster?: string[];
};

export { PARAMETERS, UPDATE_ACTIONS };
export type { Params };
