/**
 * pi-subagents: the settled notice as a card in the transcript.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { SETTLED_CUSTOM_TYPE, type SettleDetails } from "../../telemetry/notify.ts";

type CardTheme = Pick<Theme, "fg" | "bold">;

function label(status: SettleDetails["status"]): string {
	if (status === "error") return "ERROR";
	if (status === "interrupted") return "STOPPED";
	return "DONE";
}

function elapsed(ms: number): string {
	const sec = Math.max(0, Math.round(ms / 1000));
	if (sec < 60) return `${sec}s`;
	return `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}s`;
}

function tokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
	return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function firstLine(text: string): string {
	return text.split("\n")[0] ?? text;
}

export function cardLines(
	details: SettleDetails | undefined,
	expanded: boolean,
	theme: CardTheme,
): string[] {
	if (!details) return [theme.fg("dim", "(subagent settled)")];
	const color =
		details.status === "error" ? "error" : details.status === "interrupted" ? "warning" : "success";
	const glyph = details.status === "error" ? "✗" : details.status === "interrupted" ? "⊘" : "✓";
	const head = [
		theme.fg(color, glyph),
		theme.bold(details.subagent),
		theme.fg("dim", details.taskId),
		theme.fg(color, `${label(details.status)} in ${elapsed(details.elapsedMs)}`),
	];
	if (details.turns > 0) head.push(theme.fg("dim", `${details.turns} turns`));
	if (details.tokens > 0) head.push(theme.fg("dim", `${tokens(details.tokens)} tok`));
	if (details.cost !== undefined && details.cost > 0)
		head.push(theme.fg("dim", `$${details.cost.toFixed(3)}`));
	const lines = [head.join("  ")];
	const report = details.report?.trim();
	if (details.status === "error") {
		const error = details.error ?? "run failed";
		lines.push(theme.fg("error", `  ${firstLine(error)}`));
		if (expanded) {
			for (const line of error.split("\n").slice(1)) lines.push(theme.fg("error", `  ${line}`));
		}
	} else if (details.delivered) {
		lines.push(theme.fg("dim", "  report already delivered by TaskOutput"));
	} else if (report) {
		if (expanded) {
			lines.push(theme.fg("muted", "  report:"));
			for (const line of report.split("\n")) lines.push(`  ${line}`);
		} else {
			lines.push(theme.fg("dim", `  report ${details.reportChars} chars · ctrl+o to read`));
		}
	} else {
		lines.push(theme.fg("dim", "  (no output)"));
	}
	lines.push(
		theme.fg(
			"dim",
			details.status === "interrupted"
				? "  stopped · no wake notice"
				: "  final · no need to poll TaskOutput",
		),
	);
	return lines;
}

export function registerSettledCard(pi: Pick<ExtensionAPI, "registerMessageRenderer">): void {
	pi.registerMessageRenderer<SettleDetails>(SETTLED_CUSTOM_TYPE, (message, options, theme) => {
		const details = message.details as SettleDetails | undefined;
		const box = new Box(options.outputPad ?? 0, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(cardLines(details, options.expanded, theme).join("\n"), 0, 0));
		return box;
	});
}
