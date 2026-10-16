/**
 * pi-subagents: reading subagent files from disk.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_DIR_NAME } from "../domain/subagent/config.ts";
import type {
	SubagentConfig,
	SubagentFrontmatter,
	SubagentSource,
} from "../domain/subagent/config.ts";
import { validateSubagent } from "../domain/subagent/frontmatter.ts";
import type { SubagentDiscoveryResult } from "../domain/subagent/discovery.ts";

export function loadSubagentFromContent(
	content: string,
	filePath: string,
	source: SubagentSource,
): SubagentConfig | string {
	const { frontmatter, body } = parseFrontmatter<SubagentFrontmatter>(content);
	return validateSubagent(frontmatter, body, source, filePath);
}

/** Read every subagent file in one directory. Errors are collected, never thrown. */
export function loadSubagentsFromDir(
	dir: string,
	source: SubagentSource,
	errors: string[],
): SubagentConfig[] {
	const found: SubagentConfig[] = [];
	if (!fs.existsSync(dir)) return found;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			errors.push(`${filePath}: cannot read file, skipped.`);
			continue;
		}
		const parsed = loadSubagentFromContent(content, filePath, source);
		if (typeof parsed === "string") {
			errors.push(`${filePath}: ${parsed}`);
			continue;
		}
		for (const w of parsed.warnings) errors.push(`${filePath}: warn: ${w}`);
		found.push(parsed);
	}
	return found;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectSubagentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, SUBAGENT_DIR_NAME);
		if (isDirectory(candidate)) return candidate;
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

/** Discover subagents: personal + project (project wins on name clash). Errors never throw. */
export function discoverSubagents(cwd: string): SubagentDiscoveryResult {
	const errors: string[] = [];
	const userSubagentsDir = path.join(getAgentDir(), SUBAGENT_DIR_NAME);
	const projectSubagentsDir = findNearestProjectSubagentsDir(cwd);
	const userSubs = loadSubagentsFromDir(userSubagentsDir, "user", errors);
	const projectSubs = projectSubagentsDir
		? loadSubagentsFromDir(projectSubagentsDir, "project", errors)
		: [];
	const map = new Map<string, SubagentConfig>();
	for (const d of userSubs) map.set(d.name, d);
	for (const d of projectSubs) map.set(d.name, d);
	return {
		subagents: [...map.values()].toSorted((a, b) => a.name.localeCompare(b.name)),
		errors,
		userSubagentsDir,
		projectSubagentsDir,
	};
}
