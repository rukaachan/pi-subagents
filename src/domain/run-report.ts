/**
 * pi-subagents: the report a caller receives.
 */

import type { ActivityStep } from "./activity-step.ts";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { anyAssistantText } from "./run-result.ts";

export function runReport(
	session: AgentSession,
	opts: { stopNote: string | null; steps: ActivityStep[] },
): string {
	const final = (session.getLastAssistantText() ?? "").trim();
	if (final) {
		if (!opts.stopNote) return final;
		return `[cut short] ${opts.stopNote}\n\n${final}`;
	}
	const earlier = anyAssistantText(session);
	const steps = stepsBlock(opts.steps);
	if (!earlier) {
		if (!opts.stopNote && !steps) return "(no output)";
		return header(opts.stopNote) + steps;
	}
	return `${header(opts.stopNote)}\n\n${earlier}${steps}`;
}

function header(stopNote: string | null): string {
	if (stopNote) return `[cut short] ${stopNote}`;
	return "[incomplete] the run ended on a tool call; the text below is from an earlier turn.";
}

const NL = "\n";

function stepsBlock(steps: ActivityStep[]): string {
	if (steps.length === 0) return "";
	const lines = ["", "Last steps:"];
	for (const step of steps) {
		const detail = step.detail ? ` · ${step.detail}` : "";
		lines.push(`- ${step.tool}${detail}`);
	}
	return NL + lines.join(NL);
}
