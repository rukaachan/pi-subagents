/**
 * pi-subagents: the MAST family of a failed run.
 */

export const FAILURE_FAMILIES = ["spec", "coordination", "verification"] as const;
export type FailureFamily = (typeof FAILURE_FAMILIES)[number];

export const FAILURE_LABELS: Record<FailureFamily, string> = {
	spec: "specification",
	coordination: "inter-agent coordination",
	verification: "task verification",
};

export function parseFailure(value: unknown): FailureFamily | "bad" | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") return "bad";
	const family = value.trim().toLowerCase();
	return (FAILURE_FAMILIES as readonly string[]).includes(family)
		? (family as FailureFamily)
		: "bad";
}

export type FailureLabel =
	| { kind: "set"; family: FailureFamily }
	| { kind: "kept"; family: FailureFamily }
	| { kind: "running" }
	| { kind: "bad"; value: unknown };

/** The only place a label is decided; the caller writes when kind is `set`. */
export function labelFailure(
	status: string,
	current: FailureFamily | undefined,
	value: unknown,
): FailureLabel | undefined {
	const parsed = parseFailure(value);
	if (parsed === undefined) return undefined;
	if (parsed === "bad") return { kind: "bad", value };
	if (status === "running") return { kind: "running" };
	if (current) return { kind: "kept", family: current };
	return { kind: "set", family: parsed };
}

export function failureHint(): string {
	return "If you know the cause, label it once: TaskOutput(task_id, failure: spec|coordination|verification).";
}
