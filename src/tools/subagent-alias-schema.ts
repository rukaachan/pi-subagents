/**
 * pi-subagents: the subagent alias parameters.
 */

import { Type, type Static } from "@earendil-works/pi-ai";

export const subagentAliasParameters = Type.Object({
	agent: Type.String({ description: "Subagent name, e.g. explorer, worker, code-reviewer" }),
	task: Type.String({ description: "Full task for the subagent" }),
	description: Type.Optional(Type.String({ description: "Short label (defaults to agent name)" })),
	tasks: Type.Optional(Type.Any({ description: "Not supported. Run one Task per call instead." })),
	model: Type.Optional(
		Type.String({ description: "Model for this run only: provider/id, or inherit" }),
	),
	complexity: Type.Optional(Type.String({ description: "Thinking tier: light, medium, or heavy" })),
	codemode: Type.Optional(
		Type.Union([Type.Boolean(), Type.Literal("off"), Type.Literal("on"), Type.Literal("only")], {
			description:
				"Codemode for this run: off, on, or only. Omitting keeps the subagent's setting.",
		}),
	),
	chain: Type.Optional(
		Type.Array(Type.String(), {
			description: "Sequential subagents, e.g. [explorer, worker]. Each gets the prior report.",
		}),
	),
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
					"Per-run ceiling. 300s before a timeout of 900s or more, the run is asked to wrap up and report. { } disables all caps for this run; omit to keep the subagent's budget.",
			},
		),
	),
});

export type SubagentAliasParams = Static<typeof subagentAliasParameters>;
