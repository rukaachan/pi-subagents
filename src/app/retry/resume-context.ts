/**
 * pi-subagents: the context a resumed run gets, bounded and readable.
 */

import { shapeMessages } from "../../telemetry/live/index.ts";

/** Same ceiling the resume prompt used before, now spent on whole entries. */
export const RESUME_CONTEXT_CHARS = 20_000;

/** The exact handoff a resumed run receives. */
export function resumePrompt(history: readonly unknown[], prompt: string): string {
	return `Prior context (bounded, newest kept):\n${resumeContext(history)}\n\nFollow-up task: ${prompt}`;
}

export function resumeContext(history: readonly unknown[], budget = RESUME_CONTEXT_CHARS): string {
	const entries = shapeMessages(history, { full: true });
	if (entries.length === 0) return "(no prior turns)";
	const blocks = entries.map((entry) => {
		const label = entry.kind === "error" ? `${entry.label} (error)` : entry.label;
		return entry.text ? `${label}  ${entry.text}` : label;
	});
	const kept: string[] = [];
	let used = 0;
	for (let i = blocks.length - 1; i >= 0; i -= 1) {
		const block = blocks[i] ?? "";
		if (kept.length > 0 && used + block.length + 2 > budget) break;
		kept.unshift(block);
		used += block.length + 2;
	}
	const hidden = blocks.length - kept.length;
	const body = kept.join("\n\n");
	return hidden > 0 ? `… ${hidden} earlier entries hidden\n\n${body}` : body;
}
