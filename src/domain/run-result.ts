/**
 * pi-subagents: reading a finished run.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

export interface SubagentUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
}

export interface SubagentRunResult {
	text: string;
	usage: SubagentUsage;
	model?: string;
	notes: string[];
}

export function sumUsage(messages: AgentMessage[]): SubagentUsage {
	const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
	for (const m of messages) {
		if (m.role !== "assistant") continue;
		const u = m.usage;
		total.input += u.input || 0;
		total.output += u.output || 0;
		total.cacheRead += u.cacheRead || 0;
		total.cacheWrite += u.cacheWrite || 0;
		total.cost += u.cost?.total || 0;
		total.turns += 1;
	}
	return total;
}

export function lastText(session: AgentSession): string {
	return session.getLastAssistantText() ?? "(no output)";
}

export function anyAssistantText(session: AgentSession): string {
	const last = session.getLastAssistantText();
	if (last && last.trim()) return last;
	const messages = session.messages ?? [];
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const text = assistantTextOf(messages[i]);
		if (text) return text;
	}
	return "";
}

function assistantTextOf(message: unknown): string {
	try {
		const m = message as { role?: string; content?: unknown };
		if (!m || m.role !== "assistant") return "";
		const parts = Array.isArray(m.content) ? m.content : [];
		return parts
			.map((p) => {
				const block = p as { type?: string; text?: string };
				return block?.type === "text" && typeof block.text === "string" ? block.text : "";
			})
			.join(" ")
			.trim();
	} catch {
		return "";
	}
}

export function activeModelId(session: AgentSession): string | undefined {
	const m = session.model;
	return m ? `${m.provider}/${m.id}` : undefined;
}

export function snapshotHistory(session: AgentSession): AgentMessage[] {
	try {
		const copy = JSON.parse(JSON.stringify(session.messages ?? [])) as AgentMessage[];
		return Array.isArray(copy) ? copy : [];
	} catch {
		return [];
	}
}

export function recordFailure(
	target: { history: unknown[]; status: "done" | "running" | "pending" | "error"; error?: string },
	session: AgentSession,
	err: unknown,
): string {
	const message = err instanceof Error ? err.message : String(err);
	target.history = snapshotHistory(session);
	target.status = "error";
	target.error = message;
	return message;
}
