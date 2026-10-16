/**
 * pi-subagents: the trash.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { loadSubagentFromContent } from "./subagent-files.ts";
import { trashDir } from "./files.ts";

export interface TrashItem {
	fileName: string;
	trashPath: string;
	base: string;
	stamp: string;
}

export function listTrash(): TrashItem[] {
	const dir = trashDir();
	if (!fs.existsSync(dir)) return [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const items: TrashItem[] = [];
	for (const e of entries) {
		if (!e.name.endsWith(".md")) continue;
		if (!e.isFile() && !e.isSymbolicLink()) continue;
		const m = /^(.*)-(\d{4}-\d{2}-\d{2}T.*)\.md$/.exec(e.name);
		items.push({
			fileName: e.name,
			trashPath: path.join(dir, e.name),
			base: m?.[1] ?? e.name.replace(/\.md$/, ""),
			stamp: m?.[2] ? m[2].replace(/-/g, ":").slice(0, 16) : "?",
		});
	}
	return items.toSorted((a, b) => b.fileName.localeCompare(a.fileName));
}

export function trashSubagentFile(filePath: string): { trashPath: string } | { error: string } {
	const dir = trashDir();
	try {
		fs.mkdirSync(dir, { recursive: true });
		const base = path.basename(filePath, ".md");

		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const dest = path.join(dir, `${base}-${stamp}.md`);
		try {
			fs.renameSync(filePath, dest);
		} catch {
			fs.copyFileSync(filePath, dest);
			fs.unlinkSync(filePath);
		}
		return { trashPath: dest };
	} catch {
		return { error: `Cannot move ${filePath} to trash.` };
	}
}

export function restoreTrashFile(
	trashPath: string,
	dir: string,
): { path: string } | { error: string } {
	let content: string;

	try {
		content = fs.readFileSync(trashPath, "utf-8");
	} catch {
		return { error: `Cannot read ${trashPath}.` };
	}
	const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
	const name =
		typeof frontmatter.name === "string" ? frontmatter.name : path.basename(trashPath, ".md");
	const parsed = loadSubagentFromContent(content, trashPath, "user");
	if (typeof parsed === "string") return { error: `Trash file invalid: ${parsed}` };
	const target = path.join(dir, `${parsed.name}.md`);
	if (fs.existsSync(target))
		return {
			error: `Subagent "${parsed.name}" already exists. Delete it first or pick a new home.`,
		};
	try {
		fs.mkdirSync(dir, { recursive: true });
		try {
			fs.renameSync(trashPath, target);
		} catch {
			fs.copyFileSync(trashPath, target);
			fs.unlinkSync(trashPath);
		}
		return { path: target };
	} catch {
		return { error: `Cannot restore ${name}.` };
	}
}

export function deleteSubagentFile(filePath: string): string | null {
	try {
		fs.unlinkSync(filePath);
		return null;
	} catch {
		return `Cannot delete ${filePath}.`;
	}
}
