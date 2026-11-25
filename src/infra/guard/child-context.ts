/**
 * pi-subagents: the one-line cost of loading project context into a child.
 */

import { basename, relative, sep } from "node:path";

export interface ContextFile {
	path: string;
	content: string;
}

function shown(file: ContextFile, cwd: string): string {
	const rel = relative(cwd, file.path);
	return rel && !rel.startsWith("..") ? rel.split(sep).join("/") : basename(file.path);
}

/** "context: 2 files, 120 chars (AGENTS.md, src/AGENTS.md)". */
export function contextNote(files: readonly ContextFile[], cwd: string): string {
	const chars = files.reduce((sum, file) => sum + file.content.length, 0);
	const names = files.map((file) => shown(file, cwd));
	const listed = names.slice(0, 4).join(", ");
	const more = names.length > 4 ? ", …" : "";
	const count = `${files.length} ${files.length === 1 ? "file" : "files"}`;
	return `context: ${count}, ${chars} chars${names.length > 0 ? ` (${listed}${more})` : ""}`;
}
