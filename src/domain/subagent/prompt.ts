/**
 * pi-subagents: the text a child sees before its task.
 */

import type { SubagentConfig } from "./config.ts";

/** The prefix goes first, then a blank line, then the task verbatim. */
export function taskPrompt(sub: SubagentConfig, text: string): string {
	const prefix = sub.promptPrefix?.trim();
	return prefix ? `${prefix}\n\n${text}` : text;
}
