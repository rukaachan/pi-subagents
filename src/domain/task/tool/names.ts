/**
 * pi-subagents: names from the parallel argument.
 */

import { showValue } from "../../subagent/index.ts";

export function parallelNamesFrom(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		if (typeof item === "string") {
			const name = item.trim();
			if (name) out.push(name);
			continue;
		}
		if (item && typeof item === "object") {
			const raw = (item as Record<string, unknown>).subagent_type;
			const name = (
				typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : showValue(raw)
			).trim();
			if (name) out.push(name);
		}
	}
	return out;
}
