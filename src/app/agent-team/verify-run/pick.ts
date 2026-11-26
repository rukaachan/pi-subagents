/**
 * pi-subagents: choose the verifier subagent.
 */

import type { SubagentConfig } from "../../../domain/subagent/index.ts";

export function pick(
	verifyWith: string | undefined,
	subs: readonly SubagentConfig[],
): SubagentConfig | undefined {
	const wanted = verifyWith ?? "code-reviewer";
	return subs.find((sub) => sub.name === wanted) ?? subs.find((sub) => sub.name === "tester");
}
