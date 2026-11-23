/**
 * pi-subagents: the optional `paths` fence for writes.
 */

export const MAX_PATHS = 20;

export type ParsedPaths = { ok: true; paths: string[] } | { ok: false; error: string };

export function parsePaths(raw: unknown): ParsedPaths {
	if (raw === undefined || raw === null || raw === "") return { ok: true, paths: [] };
	const list = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : null;
	if (!list)
		return { ok: false, error: "paths must be a folder, a comma-separated list, or a list." };
	const out: string[] = [];
	for (const item of list) {
		if (typeof item !== "string") return { ok: false, error: "each paths entry must be a string." };
		const value = item.trim();
		if (value) out.push(value);
	}
	if (out.length === 0)
		return { ok: false, error: "paths is empty; drop the field or name a folder." };
	if (out.length > MAX_PATHS) {
		return { ok: false, error: `paths takes at most ${MAX_PATHS} entries.` };
	}
	return { ok: true, paths: [...new Set(out)] };
}

export function pathsRefusal(target: string, roots: readonly string[]): string {
	return `Refused: ${target} is outside this subagent paths (${roots.join(", ")}).`;
}
