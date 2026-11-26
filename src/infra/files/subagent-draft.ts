/**
 * pi-subagents: write a starter draft without overwriting one.
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { SUBAGENT_DIR_NAME } from "../../domain/subagent/index.ts";

const NAME_RE = /^[a-z][a-z0-9-]{1,31}$/;

export function draftsDir(agentDir: string = getAgentDir()): string {
	return path.join(agentDir, SUBAGENT_DIR_NAME, "drafts");
}

export function writeSubagentDraft(
	name: string,
	content: string,
	agentDir: string = getAgentDir(),
): { ok: true; path: string } | { ok: false; error: string } {
	if (!NAME_RE.test(name)) return { ok: false, error: "Draft name must be a lowercase slug." };
	const dir = draftsDir(agentDir);
	try {
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
	for (let suffix = 1; suffix <= 99; suffix += 1) {
		const file = path.join(dir, suffix === 1 ? `${name}.md` : `${name}-${suffix}.md`);
		try {
			fs.writeFileSync(file, content, { flag: "wx", mode: 0o600 });
			return { ok: true, path: file };
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	}
	return { ok: false, error: "Too many draft names; remove one or choose another task." };
}
