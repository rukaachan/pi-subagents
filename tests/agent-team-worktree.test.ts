import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	beginAgentTeamSession,
	createTask,
	getTask,
	setTaskWorktree,
} from "../src/app/agent-team/board/index.ts";
import { worktreeAction } from "../src/app/agent-team/worktree/index.ts";
import { createWorktree } from "../src/infra/worktree/index.ts";

function ctx(cwd: string): ExtensionContext {
	return { cwd, ui: { setStatus: () => {} } } as unknown as ExtensionContext;
}

function git(repo: string, args: string[]): string {
	return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}

let dir = "";
let repo = "";
let previous: string | undefined;

function taskWithWorktree(): string {
	const created = createTask({ subject: "one", description: "" });
	assert.ok(created.ok);
	const made = createWorktree(repo, created.task.id);
	assert.ok(made.ok);
	setTaskWorktree(created.task.id, made.worktree);
	return created.task.id;
}

function journal(): Record<string, unknown>[] {
	const file = join(dir, "journal.ndjson");
	if (!existsSync(file)) return [];
	const text = readFileSync(file, "utf8").trim();
	return text ? text.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) : [];
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-team-wt-"));
	repo = join(dir, "repo");
	mkdirSync(repo, { recursive: true });
	git(repo, ["init", "-q"]);
	writeFileSync(join(repo, "README.md"), "base\n");
	git(repo, ["add", "README.md"]);
	git(repo, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);
	previous = process.env.PI_SUBAGENTS_JOURNAL;
	process.env.PI_SUBAGENTS_JOURNAL = join(dir, "journal.ndjson");
	beginAgentTeamSession("s-wt-action");
});

afterEach(() => {
	if (previous === undefined) delete process.env.PI_SUBAGENTS_JOURNAL;
	else process.env.PI_SUBAGENTS_JOURNAL = previous;
	rmSync(dir, { recursive: true, force: true });
});

describe("worktree action", () => {
	it("shows status and journals it", () => {
		const id = taskWithWorktree();
		const result = worktreeAction(id, "status", ctx(repo));
		assert.ok(result.ok);
		assert.match(result.text, /clean/);
		assert.equal(journal().at(-1)?.event, "agent_team_worktree");
	});

	it("removes only a clean worktree on merged and keeps it otherwise", () => {
		const id = taskWithWorktree();
		const path = getTask(id)?.task.worktree?.path ?? "";
		writeFileSync(join(path, "scratch.txt"), "wip\n");
		const refused = worktreeAction(id, "merged", ctx(repo));
		assert.equal(refused.ok, false);
		if (!refused.ok) assert.match(refused.error, /uncommitted/);
		assert.equal(existsSync(path), true);
		const forced = worktreeAction(id, "remove", ctx(repo));
		assert.ok(forced.ok);
		assert.equal(existsSync(path), false);
		assert.equal(getTask(id)?.task.worktree, undefined);
	});

	it("marks a clean worktree merged and removes it", () => {
		const id = taskWithWorktree();
		const path = getTask(id)?.task.worktree?.path ?? "";
		const merged = worktreeAction(id, "merged", ctx(repo));
		assert.ok(merged.ok);
		assert.equal(existsSync(path), false);
		assert.equal(typeof getTask(id)?.task.worktree?.mergedAt, "number");
		assert.equal(journal().at(-1)?.action, "merged");
	});

	it("refuses tasks without a worktree and unknown tasks", () => {
		const created = createTask({ subject: "plain", description: "" });
		assert.ok(created.ok);
		const plain = worktreeAction(created.task.id, "status", ctx(repo));
		assert.equal(plain.ok, false);
		if (!plain.ok) assert.match(plain.error, /no worktree/);
		const missing = worktreeAction("task-99", "status", ctx(repo));
		assert.equal(missing.ok, false);
		if (!missing.ok) assert.match(missing.error, /Unknown task/);
	});
});
