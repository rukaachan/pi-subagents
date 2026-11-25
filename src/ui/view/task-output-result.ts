/**
 * pi-subagents: paint a TaskOutput result.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { shortText } from "./format.ts";
import { resultShell, usageFooter } from "../tool-results.ts";

interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
}

interface Details {
	task_id?: string;
	status?: string;
	error?: string;
	usage?: Usage;
	model?: string;
	failure?: string;
	missing?: string[];
	turns?: number;
	elapsedSec?: number;
	tool?: string;
}

export interface OutputResult {
	content: { type: string; text?: string }[];
	details?: unknown;
	isError?: boolean;
}

export function renderTaskOutputResult(result: OutputResult, expanded: boolean, theme: Theme) {
	const details = result.details as Details | undefined;
	const text = result.content[0];
	const body = text?.type === "text" ? (text.text ?? "") : "(no output)";
	const id = details?.task_id ?? "";
	if (details?.status === "stopped") {
		return new Text(
			`${theme.fg("warning", "⊘ TaskOutput")} ${theme.fg("accent", id)} ${theme.fg("dim", shortText(body, 200))}`,
			0,
			0,
		);
	}
	if (
		details?.status === "error" ||
		details?.error ||
		body.startsWith("Unknown task_id") ||
		body.includes("was stopped") ||
		body.includes("has no result")
	) {
		return new Text(
			`${theme.fg("error", "✗ TaskOutput")} ${theme.fg("accent", id)} ${theme.fg("dim", shortText(body, 200))}`,
			0,
			0,
		);
	}
	if (details?.status === "running") {
		const parts: string[] = ["running"];
		if (typeof details.turns === "number") parts.push(`t${details.turns}`);
		if (typeof details.elapsedSec === "number") parts.push(`${details.elapsedSec}s`);
		if (typeof details.tool === "string") parts.push(details.tool);
		return new Text(
			`${theme.fg("warning", "… TaskOutput")} ${theme.fg("accent", id)} ${theme.fg("dim", parts.join(" · "))}`,
			0,
			0,
		);
	}
	const head = `${theme.fg("success", "✓ TaskOutput")} ${theme.fg("accent", id)}${usageFooter(theme, details?.usage, details?.model)}`;
	return resultShell(theme, head, body, 2000, 160, expanded);
}
