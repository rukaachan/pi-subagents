/**
 * pi-subagents: formatting primitives for every list.
 */

import * as os from "node:os";
import type { TrashItem } from "../../infra/trash.ts";
import type { SubagentRunResult } from "../../domain/run-result.ts";
import type { TaskRecord } from "../../app/task-record.ts";

export function shortPath(p: string): string {
	const home = os.homedir();
	if (p.startsWith(home)) return `~${p.slice(home.length)}`;
	return p;
}

export function shortKey(key: string): string {
	return key.replace(/[^a-z0-9]/gi, "").slice(-6) || key;
}

export function shortText(text: string, max = 80): string {
	const one = text.replace(/\s+/g, " ").trim();
	if (one.length <= max) return one;
	return `${one.slice(0, max - 1)}…`;
}

export function sourceBadge(source: string): string {
	return source === "project" ? "◈ project" : "◇ personal";
}

export function kindBadge(kind?: string): string {
	if (kind === "foreground") return "● fg";
	if (kind === "alias") return "◐ alias";
	if (kind === "chain") return "⛓ chain";
	if (kind === "parallel") return "⇉ par";
	return "○ bg";
}

export function toolsBadge(tools?: string[]): string {
	if (!tools) return "all";
	const set = new Set(tools);
	const ro = ["read", "grep", "find", "ls"];
	const ed = [...ro, "edit", "write"];
	const ex = [...ed, "bash"];
	const eq = (list: string[]) => list.length === tools.length && list.every((t) => set.has(t));
	if (eq(ro)) return "read-only";
	if (eq(ed)) return "edit";
	if (eq(ex)) return "execute";
	return tools.join("+");
}

export function rowName(row: string): string {
	return row.split(" ")[0] ?? row;
}

export function usageLine(usage: SubagentRunResult["usage"], model?: string): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns}t`);
	const tok = usage.input + usage.output;
	if (tok) parts.push(`${tok}tok`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

export function taskStatusIcon(status: TaskRecord["status"]): string {
	if (status === "running") return "…";
	if (status === "done") return "✓";
	return "✗";
}

export function rowTaskKey(row: string): string {
	return row.split(" ")[1] ?? "";
}

export function kvTable(rows: [string, string][]): string {
	const width = rows.reduce((n, [k]) => Math.max(n, k.length), 0);
	return rows.map(([k, v]) => `${k.padEnd(width)}  ${v}`).join("\n");
}

export function stepTitle(step: number, total: number, label: string): string {
	const dots = "●".repeat(step) + "○".repeat(Math.max(0, total - step));
	return `${dots} ${label} (${step}/${total})`;
}

export function trashRow(item: TrashItem): string {
	return `${item.base} · ${item.stamp}`;
}

export function trashBase(row: string): string {
	return row.split(" ")[0] ?? row;
}

export function modelRow(provider: string, id: string): string {
	return `${provider}/${id}`;
}
