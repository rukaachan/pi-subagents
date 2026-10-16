/**
 * pi-subagents: choosing a subagent from the prompt text.
 */

import { dispatchSubagent, type DispatchVerdict } from "../../domain/dispatch.ts";

export type PickEcho = { chosen: string; rule: string; matched: string };

/** Refuse an unroutable prompt with the roster; never guess between roles. */
function refusal(verdict: DispatchVerdict, roster: string) {
	if (verdict.kind === "ambiguous") {
		return {
			content: [
				{
					type: "text" as const,
					text: `Prompt fits multiple roles (${verdict.rules.join(" vs ")}). Name one: ${roster}.`,
				},
			],
			details: { dispatch: "ambiguous", rules: verdict.rules },
			isError: true as const,
		};
	}
	return {
		content: [
			{
				type: "text" as const,
				text: `Could not pick a subagent from the prompt text. Name one: ${roster}.`,
			},
		],
		details: { dispatch: "none" },
		isError: true as const,
	};
}

export function pickFromPrompt(
	text: string,
	roster: string[],
): { name: string; echo: PickEcho } | { error: ReturnType<typeof refusal> } {
	const verdict = dispatchSubagent(text);
	if (verdict.kind !== "picked") {
		return { error: refusal(verdict, roster.join(", ") || "none") };
	}
	return {
		name: verdict.subagent,
		echo: { chosen: verdict.subagent, rule: verdict.rule, matched: verdict.matched },
	};
}
