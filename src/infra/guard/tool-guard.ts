/**
 * pi-subagents: fencing write and edit to a subagent paths field.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { pathsRefusal } from "../../domain/subagent/index.ts";

const MAX_LINK_DEPTH = 64;

function isInside(base: string, target: string): boolean {
	const relative = path.relative(base, target);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Resolve every existing symlink, including a dangling final one. Null means a loop. */
function resolveForCompare(target: string): string | null {
	let current = path.resolve(target);
	const tail: string[] = [];
	for (let depth = 0; depth < MAX_LINK_DEPTH; depth += 1) {
		try {
			const real = fs.realpathSync.native(current);
			return tail.length > 0 ? path.join(real, ...tail.toReversed()) : real;
		} catch {
			/* not a complete existing path */
		}
		try {
			const link = fs.readlinkSync(current);
			current = path.resolve(path.dirname(current), link);
			continue;
		} catch {
			/* not a symlink */
		}
		const parent = path.dirname(current);
		if (parent === current) {
			return path.join(current, ...tail.toReversed());
		}
		tail.push(path.basename(current));
		current = parent;
	}
	return null;
}

export function isPathAllowed(target: string, roots: readonly string[], cwd: string): boolean {
	const workspace = resolveForCompare(cwd);
	const absolute = resolveForCompare(path.resolve(cwd, target));
	if (!workspace || !absolute) return false;
	return roots.some((root) => {
		const real = resolveForCompare(path.resolve(cwd, root));
		return !!real && isInside(workspace, real) && isInside(real, absolute);
	});
}

export function guardPaths<TParams extends TSchema, TDetails, TState>(
	definition: ToolDefinition<TParams, TDetails, TState>,
	roots: readonly string[],
	cwd: string,
): ToolDefinition<TParams, TDetails, TState> {
	const run = definition.execute.bind(definition);
	const execute = (async (...args: Parameters<typeof run>) => {
		const target = (args[1] as { path?: unknown }).path;
		if (typeof target === "string" && !isPathAllowed(target, roots, cwd)) {
			return {
				content: [{ type: "text" as const, text: pathsRefusal(target, roots) }],
				details: { blocked: true, path: target },
				isError: true,
			};
		}
		return run(...args);
	}) as ToolDefinition<TParams, TDetails, TState>["execute"];
	return { ...definition, execute };
}
