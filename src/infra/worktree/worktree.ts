/**
 * pi-subagents: one git worktree per isolated board task.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const GIT_TIMEOUT_MS = 10_000;

export interface CreatedWorktree {
	path: string;
	base: string;
	createdAt: number;
}

export type WorktreeState = "clean" | "dirty" | "missing" | "unknown";

function git(
	cwd: string,
	args: string[],
): { ok: true; out: string } | { ok: false; error: string } {
	try {
		const out = execFileSync("git", ["-C", cwd, ...args], {
			encoding: "utf8",
			timeout: GIT_TIMEOUT_MS,
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { ok: true, out };
	} catch (err) {
		const row = err as { stderr?: string | Buffer; message?: string };
		const stderr = row.stderr?.toString().trim();
		return { ok: false, error: stderr || row.message || "git failed" };
	}
}

function key(cwd: string): string {
	return createHash("sha1").update(cwd).digest("hex").slice(0, 12);
}

function cleanId(taskId: string): string {
	return taskId.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function worktreeRoot(cwd: string): string {
	return path.join(os.tmpdir(), "pi-subagents-worktrees", key(cwd));
}

export function createWorktree(
	cwd: string,
	taskId: string,
	now = Date.now(),
): { ok: true; worktree: CreatedWorktree } | { ok: false; error: string } {
	const top = git(cwd, ["rev-parse", "--show-toplevel"]);
	if (!top.ok) return { ok: false, error: "Workspace is not a git repository." };
	const head = git(cwd, ["rev-parse", "HEAD"]);
	if (!head.ok) return { ok: false, error: "Repository has no commit to base the worktree on." };
	const id = cleanId(taskId);
	if (!id) return { ok: false, error: "Task id cannot name a worktree." };
	const root = worktreeRoot(cwd);
	const target = path.join(root, id);
	try {
		fs.mkdirSync(root, { recursive: true });
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
	if (fs.existsSync(target)) {
		return { ok: false, error: `Worktree path already exists: ${target}` };
	}
	const added = git(cwd, ["worktree", "add", "--detach", target, head.out.trim()]);
	if (!added.ok) return { ok: false, error: added.error };
	return {
		ok: true,
		worktree: { path: target, base: head.out.trim(), createdAt: now },
	};
}

export interface WorktreeRow {
	path: string;
	head?: string;
	branch?: string;
}

export function listWorktrees(cwd: string): WorktreeRow[] {
	const listed = git(cwd, ["worktree", "list", "--porcelain"]);
	if (!listed.ok) return [];
	const rows: WorktreeRow[] = [];
	let row: WorktreeRow | undefined;
	for (const line of listed.out.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (row) rows.push(row);
			row = { path: line.slice("worktree ".length) };
		} else if (row && line.startsWith("HEAD ")) row.head = line.slice("HEAD ".length);
		else if (row && line.startsWith("branch ")) row.branch = line.slice("branch ".length);
	}
	if (row) rows.push(row);
	return rows;
}

export function worktreeState(target: string): WorktreeState {
	if (!fs.existsSync(target)) return "missing";
	const status = git(target, ["status", "--porcelain"]);
	if (!status.ok) return "unknown";
	return status.out.trim() ? "dirty" : "clean";
}

export function removeWorktree(
	cwd: string,
	target: string,
	force: boolean,
): { ok: true } | { ok: false; error: string } {
	const args = ["worktree", "remove", ...(force ? ["--force"] : []), target];
	const removed = git(cwd, args);
	return removed.ok ? { ok: true } : { ok: false, error: removed.error };
}
