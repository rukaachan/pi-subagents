/**
 * Visual preview: render the real picker rows to text so the layout can be checked without a terminal.
 */

import { getSelectListTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { SelectList } from "@earendil-works/pi-tui";
import { subagentRowItems, taskRowItems, trashRowItems } from "../src/ui/menu/items.ts";
import { discoverSubagents } from "../src/domain/subagent/discovery.ts";
import { fitDescriptions } from "../src/ui/picker-render.ts";
import type { TaskRecord } from "../src/app/task-record.ts";

initTheme("dark", false);

// oxlint-disable-next-line no-control-regex -- ANSI escape codes
const strip = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, "");

const width = Number(process.argv[2] ?? 78);

function frame(title: string, subtitle: string | undefined, rows: string[]): void {
	const out: string[] = [];
	out.push("─".repeat(width));
	out.push(` ${title}`);
	if (subtitle) out.push(` ${subtitle}`);
	out.push("");
	for (const r of rows) out.push(` ${strip(r)}`);
	out.push("");
	out.push(" ↑↓ move   enter select   esc cancel");
	out.push("─".repeat(width));
	console.log(out.join("\n"));
}

/** The real subagent files, so the preview cannot drift from what ships. */
const { subagents: SUBS, errors } = discoverSubagents(process.cwd());
if (errors.length > 0) console.log("discovery notes:", errors.join("; "));

const task = (over: Partial<TaskRecord>): TaskRecord =>
	({ taskId: "task-abc12345-1", status: "done", createdAt: Date.now(), ...over }) as TaskRecord;

const section = (name: string): void =>
	console.log(`\n═══ ${name} ${"═".repeat(Math.max(0, width - name.length - 6))}`);

const list = (items: { value: string; label: string; description?: string }[]): string[] => {
	fitDescriptions(items, width - 4);
	return new SelectList(items, 12, getSelectListTheme(), {
		minPrimaryColumnWidth: 13,
		maxPrimaryColumnWidth: 19,
	}).render(width - 4);
};

console.log(`pi-subagents picker preview — width ${width}\n`);

section("Subagents");
frame(
	`Subagents (${SUBS.length})`,
	"◇ personal ◈ project · enter opens one",
	list(subagentRowItems(SUBS)),
);

section("Tasks");
frame(
	"1 live · 0 errors · 4 spawned",
	"● fg ● alias ○ bg · live first",
	list(
		taskRowItems([
			task({
				taskId: "task-mvby0gbu-1",
				subagentName: "explorer",
				description: "Find every call site of runSubagent",
				status: "running",
			}),
			task({
				taskId: "task-mvby603j-1",
				subagentName: "worker",
				description: "Add oxc tooling and fix lint errors",
				status: "done",
			}),
			task({
				taskId: "task-mvby9xk2-1",
				subagentName: "code-reviewer",
				description: "Review the menu rewrite since v0.8.0",
				status: "done",
				usage: { input: 12000, output: 3000, total: 15000 },
			}),
		]),
	),
);

section("Trash");
frame(
	"Trash (2)",
	"deleted subagent files · restore to personal or project",
	list(
		trashRowItems([
			{
				base: "old-worker-20260101-120000.md",
				fileName: "old-worker.md",
				stamp: "2026-01-01 12:00",
				trashPath: "/tmp/x",
			},
			{
				base: "spike-20260101-130000.md",
				fileName: "spike.md",
				stamp: "2026-01-01 13:00",
				trashPath: "/tmp/y",
			},
		]),
	),
);

console.log(
	"\nChecks: every row is one line; the label column lines up; descriptions truncate with … instead of wrapping.",
);
