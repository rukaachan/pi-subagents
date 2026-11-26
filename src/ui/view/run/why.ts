/**
 * pi-subagents: the short answer to "why did this run end this way?".
 */

import type { TaskRecord } from "../../../domain/task/index.ts";

function toolNames(history: readonly unknown[]): string[] {
	const names: string[] = [];
	for (const row of history) {
		if (!row || typeof row !== "object") continue;
		const message = row as { role?: unknown; content?: unknown };
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const block of message.content) {
			if (!block || typeof block !== "object") continue;
			const item = block as { type?: unknown; name?: unknown };
			if (item.type === "toolCall" && typeof item.name === "string") names.push(item.name);
		}
	}
	return names.slice(-5);
}

function assistantTurns(history: readonly unknown[]): number {
	let turns = 0;
	for (const row of history) {
		if (!row || typeof row !== "object") continue;
		if ((row as { role?: unknown }).role === "assistant") turns += 1;
	}
	return turns;
}

function head(value: string, max: number): string {
	const line = value.replace(/\s+/g, " ").trim();
	return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

export function whyText(rec: TaskRecord): string {
	const usage = rec.result?.usage;
	const turns = usage?.turns ?? assistantTurns(rec.history);
	const tokens = usage ? usage.input + usage.output : 0;
	const tools = toolNames(rec.history);
	const lines = [`why: ${rec.status}`];
	if (rec.failure) lines.push(`failure: ${rec.failure}`);
	const failing = rec.steps?.find((step) => step.status === "error");
	if (failing) lines.push(`step: ${failing.idx + 1} ${failing.subagentName}`);
	lines.push(`turns: ${turns} · tokens: ${tokens}`);
	if (tools.length > 0) lines.push(`tools: ${tools.join(", ")}`);
	if (rec.error) lines.push(`last error: ${head(rec.error, 300)}`);
	if (rec.result?.text) lines.push(`report: ${head(rec.result.text, 300)}`);
	return lines.join("\n");
}
