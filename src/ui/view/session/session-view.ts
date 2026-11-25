/**
 * pi-subagents: open a run's transcript, or print it when there is no TUI.
 */

import { copyToClipboard, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { TaskRecord } from "../../../domain/task/index.ts";
import { sumUsage } from "../../../domain/run/index.ts";
import { liveSession } from "../../../app/live/index.ts";
import { inModal } from "../../../app/stop/index.ts";
import { formatElapsed, footerProgress } from "../../../telemetry/live/index.ts";
import { transcriptEntries, type TranscriptEntry } from "../../../telemetry/live/index.ts";
import { createSessionView } from "./session-screen.ts";
import { shortText, taskStatusIcon } from "../text/index.ts";

// ctx.ui.custom mounts in the editor slot, so leave room for Pi's chrome.
const RESERVED_ROWS = 8;

function plainText(entries: TranscriptEntry[]): string {
	return entries
		.slice(-40)
		.map((e) => (e.text ? `${e.label}  ${e.text}` : e.label))
		.join("\n");
}

function usageLine(messages: readonly unknown[]): string {
	const usage = sumUsage(messages as Parameters<typeof sumUsage>[0]);
	const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	if (tokens <= 0) return "";
	const count = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
	return usage.cost > 0 ? `${count} tok · $${usage.cost.toFixed(4)}` : `${count} tok`;
}

export async function openSessionView(
	ctx: ExtensionCommandContext,
	rec: TaskRecord,
): Promise<void> {
	const live = rec.status === "running" ? liveSession(rec.taskId) : undefined;
	const source = live ? live.messages : () => rec.history;
	const messages = source();
	const custom = ctx.ui.custom;
	// RPC exposes custom() as a no-op, so only the TUI can mount the screen.
	if (typeof custom !== "function" || ctx.mode !== "tui") {
		const entries = transcriptEntries(messages);
		ctx.ui.notify(
			entries.length > 0 ? plainText(entries) : "No transcript: this run has no messages.",
			"info",
		);
		return;
	}
	let usageCount = -1;
	let usageCache = "";
	const usage = (): string => {
		const now = source();
		if (now.length !== usageCount) {
			usageCount = now.length;
			usageCache = usageLine(now);
		}
		return usageCache;
	};
	const stats = (): string => {
		const bits = [rec.status.toUpperCase()];
		const snap = footerProgress.snapshot(rec.taskId);
		if (snap) {
			bits.push(`${snap.turns}t`);
			if (snap.tool) bits.push(snap.tool);
			bits.push(formatElapsed(snap.elapsedSec));
		} else if (rec.status === "running") {
			bits.push(formatElapsed(Math.max(0, Math.round((Date.now() - rec.createdAt) / 1000))));
		}
		const spent = usage();
		if (spent) bits.push(spent);
		return bits.join(" · ");
	};
	await inModal(() =>
		custom<void>((tui, theme, _kb, done) => {
			const view = createSessionView({
				title: `${taskStatusIcon(rec.status)} ${rec.subagentName} · ${shortText(rec.description, 40)}`,
				stats,
				source,
				height: () => Math.max(10, tui.terminal.rows - RESERVED_ROWS),
				theme,
				empty:
					rec.status === "running" ? "waiting for the first message…" : "(no transcript saved)",
				render: () => tui.requestRender(),
				onClose: () => done(),
				poll: rec.status === "running",
				alive: () => rec.status === "running",
				streaming: live?.streaming,
				subscribe: live?.subscribe,
				onCopy: (text) => {
					void copyToClipboard(text).catch(() => {});
				},
			});
			return { ...view, dispose: view.dispose };
		}),
	);
}
