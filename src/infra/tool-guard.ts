/**
 * pi-subagents: fencing write and edit to a subagent paths field.
 */

import * as path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { pathsRefusal } from "../domain/subagent/paths.ts";

export function isPathAllowed(target: string, roots: readonly string[], cwd: string): boolean {
	const absolute = path.resolve(cwd, target);
	return roots.some((root) => {
		const relative = path.relative(path.resolve(cwd, root), absolute);
		return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
