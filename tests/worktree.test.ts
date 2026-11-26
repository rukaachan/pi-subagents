import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createWorktree,
	listWorktrees,
	removeWorktree,
	worktreeState,
} from "../src/infra/worktree/index.ts";

function git(repo: string, args: string[]): string {
	return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}

function makeRepo(): string {
	const repo = mkdtempSync(join(tmpdir(), "pi-wt-repo-"));
	git(repo, ["init", "-q"]);
	writeFileSync(join(repo, "README.md"), "base\n");
	git(repo, ["add", "README.md"]);
	git(repo, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);
	return repo;
}

let repo = "";
let other = "";

beforeEach(() => {
	repo = makeRepo();
	other = mkdtempSync(join(tmpdir(), "pi-wt-other-"));
});

afterEach(() => {
	rmSync(repo, { recursive: true, force: true });
	rmSync(other, { recursive: true, force: true });
});

describe("worktree infra", () => {
	it("creates a detached worktree and lists it", () => {
		const made = createWorktree(repo, "task-1");
		assert.ok(made.ok);
		assert.ok(existsSync(made.worktree.path));
		assert.match(made.worktree.path, /pi-subagents-worktrees/);
		assert.equal(made.worktree.base.length, 40);
		assert.equal(worktreeState(made.worktree.path), "clean");
		const rows = listWorktrees(repo);
		assert.ok(rows.some((row) => row.path === repo));
		assert.ok(rows.some((row) => row.path === made.worktree.path));
		assert.ok(removeWorktree(repo, made.worktree.path, false).ok);
		assert.equal(existsSync(made.worktree.path), false);
	});

	it("reports dirty and refuses a clean remove", () => {
		const made = createWorktree(repo, "task-2");
		assert.ok(made.ok);
		writeFileSync(join(made.worktree.path, "scratch.txt"), "wip\n");
		assert.equal(worktreeState(made.worktree.path), "dirty");
		const refused = removeWorktree(repo, made.worktree.path, false);
		assert.equal(refused.ok, false);
		assert.ok(removeWorktree(repo, made.worktree.path, true).ok);
		assert.equal(existsSync(made.worktree.path), false);
	});

	it("refuses a missing path and a non-git workspace", () => {
		assert.equal(worktreeState(join(other, "nope")), "missing");
		const made = createWorktree(other, "task-3");
		assert.equal(made.ok, false);
		if (!made.ok) assert.match(made.error, /not a git repository/);
		assert.deepEqual(listWorktrees(other), []);
	});

	it("does not overwrite an existing worktree path", () => {
		const first = createWorktree(repo, "task-4");
		assert.ok(first.ok);
		const second = createWorktree(repo, "task-4");
		assert.equal(second.ok, false);
		if (!second.ok) assert.match(second.error, /already exists/);
		assert.ok(removeWorktree(repo, first.worktree.path, true).ok);
	});
});
