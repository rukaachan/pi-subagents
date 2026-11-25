/**
 * pi-subagents: nameless dispatch.
 */

export type FanoutAdmission = { ok: true } | { ok: false; reason: string };

export function fanoutAdmission(count: number, cap: number): FanoutAdmission {
	if (Number.isInteger(count) && count >= 1 && count <= cap) return { ok: true };
	return {
		ok: false,
		reason: `Fan-out refused: ${count} legs against a live cap of ${cap}. Split into batches of ${cap} or fewer and poll with TaskOutput between them.`,
	};
}

export interface DispatchRule {
	subagent: string;
	rule: string;
	keywords: string[];
	tier?: "fallback";
}

export const DISPATCH_RULES: readonly DispatchRule[] = [
	{
		subagent: "code-reviewer",
		rule: "review",
		keywords: ["review", "code review", "looks good", "approve", "findings"],
	},
	{
		subagent: "tester",
		rule: "test",
		keywords: ["test", "failing", "reproduce", "regression", "spec"],
	},
	{
		subagent: "researcher",
		rule: "research",
		keywords: ["research", "paper", "source", "citation", "compare options"],
	},
	{
		subagent: "planner",
		rule: "plan",
		keywords: ["plan", "break down", "roadmap", "approach", "steps to"],
	},
	{
		subagent: "explorer",
		rule: "explore",
		keywords: ["find", "locate", "where is", "map", "explore", "which file"],
	},
	{
		subagent: "worker",
		rule: "implement",
		keywords: ["implement", "refactor", "migrate", "build", "add", "fix", "write"],
		tier: "fallback",
	},
];

export type DispatchVerdict =
	| { kind: "picked"; subagent: string; rule: string; matched: string }
	| { kind: "ambiguous"; rules: string[] }
	| { kind: "none" };

function hit(text: string, keyword: string): boolean {
	const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
	return pattern.test(text);
}

export function dispatchSubagent(text: string): DispatchVerdict {
	const lower = text.toLowerCase();
	const hits: Array<{ rule: DispatchRule; matched: string }> = [];
	for (const r of DISPATCH_RULES) {
		const matched = r.keywords.find((k) => hit(lower, k));
		if (matched) hits.push({ rule: r, matched });
	}
	const specs = hits.filter((h) => h.rule.tier !== "fallback");
	if (specs.length >= 2) {
		return { kind: "ambiguous", rules: specs.map((s) => s.rule.rule) };
	}
	const first = specs[0] ?? hits[0];
	if (first) {
		return {
			kind: "picked",
			subagent: first.rule.subagent,
			rule: first.rule.rule,
			matched: first.matched,
		};
	}
	return { kind: "none" };
}
