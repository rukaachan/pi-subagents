/**
 * pi-subagents: the Task parameter schema.
 */

import { Type, type Static } from "@earendil-works/pi-ai";
import { taskArgs } from "../../infra/host-shim.ts";

export const taskParameters = Type.Object({
	subagent_type: Type.Optional(
		Type.String({
			description:
				"Subagent name, e.g. explorer, worker, code-reviewer. Omit to let the pack pick from the prompt text (the pick and its rule are echoed).",
		}),
	),
	description: Type.String({ description: "Short label for the UI" }),
	prompt: Type.String({ description: "Full task for the subagent" }),
	complexity: Type.Optional(Type.String({ description: "Thinking tier: light, medium, or heavy" })),
	model: Type.Optional(
		Type.String({ description: "Model for this run only: provider/id, or inherit" }),
	),
	codemode: Type.Optional(
		Type.Union([Type.Boolean(), Type.Literal("off"), Type.Literal("on"), Type.Literal("only")], {
			description:
				"Codemode for this run: off, on, or only. Omitting keeps the subagent's setting.",
		}),
	),
	chain: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Sequential subagents, e.g. [explorer, worker, reviewer]. Each gets the prior report.",
		}),
	),
	parallel: Type.Optional(
		Type.Array(
			Type.Union([
				Type.String(),
				Type.Object({ subagent_type: Type.String(), prompt: Type.String() }),
			]),
			{
				description:
					"Fan-out subagents run at the same time, e.g. [explorer, tester] or [{subagent_type: 'explorer', prompt: '...'}].",
			},
		),
	),
	run_in_background: Type.Optional(
		Type.Boolean({ description: "True: return task_id now, poll with TaskOutput" }),
	),
	resume: Type.Optional(Type.String({ description: "task_id of a done task to continue" })),
	budget: Type.Optional(
		Type.Object(
			{
				timeoutSec: Type.Optional(
					Type.Integer({
						description:
							"Hard wall-clock ceiling in seconds: abort the run this long after it starts. 0 = off.",
					}),
				),
				maxTurns: Type.Optional(
					Type.Integer({
						description: "Stop after this many assistant turns. 0 (the starter default) = off.",
					}),
				),
				maxInputTokens: Type.Optional(
					Type.Integer({
						description:
							"Stop once summed prompt tokens (cached reads included) pass this line. 0 = off.",
					}),
				),
				maxReportChars: Type.Optional(
					Type.Integer({ description: "Cut the returned report at this many characters" }),
				),
			},
			{
				description:
					"Per-run ceiling. timeoutSec is the wall-clock guard; maxTurns and maxInputTokens are 0 (off) in the starters. 300s before a timeout of 900s or more, the run is asked to stop and report a status first. { } disables every cap; omit to keep the subagent's budget.",
			},
		),
	),
	temp_definition: Type.Optional(
		Type.Object(
			{
				name: Type.String({
					description:
						"Session-temp subagent name: lowercase letters, digits, hyphens (2-32 chars). Never shadows a persistent starter.",
				}),
				description: Type.String({
					description: "One line shown in menus and rows (≤200 chars).",
				}),
				systemPrompt: Type.String({
					description:
						'Full "you are xxx" system prompt. Cap: 20 lines, max 120 characters per line.',
				}),
				model: Type.Optional(Type.String({ description: "provider/id, or inherit (default)" })),
				tools: Type.Optional(
					Type.Array(Type.String(), {
						description: "Tool ids; omit = all tools, clamped by system autonomy.",
					}),
				),
				codemode: Type.Optional(
					Type.Boolean({ description: "True: grant the codemode scripting tool" }),
				),
				budget: Type.Optional(
					Type.Object(
						{
							maxTurns: Type.Optional(
								Type.Integer({ description: "Stop after this many assistant turns" }),
							),
							maxInputTokens: Type.Optional(
								Type.Integer({ description: "Stop once summed input tokens pass this line" }),
							),
							maxReportChars: Type.Optional(
								Type.Integer({ description: "Cut the returned report at this many characters" }),
							),
						},
						{ description: "Session ceilings for this temp subagent" },
					),
				),
			},
			{
				description:
					"Register a session-temporary subagent (nothing written to disk; dies with the session) and run this task with it. Reuse the name in later Task calls, chains, or fan-out legs.",
			},
		),
	),
});

export type TaskParams = Static<typeof taskParameters>;

export const taskSchema = {
	prepareArguments: (args: unknown) => taskArgs(args) as never,
	parameters: taskParameters,
};
