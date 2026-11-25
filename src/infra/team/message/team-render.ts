/**
 * pi-subagents: compact Team tool surfaces.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

function short(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function renderTeamCall(
	action: unknown,
	theme: Pick<Theme, "fg" | "bold">,
	label = "Team",
): Text {
	return new Text(
		`${theme.fg("toolTitle", theme.bold(`${label} `))}${theme.fg("accent", String(action ?? "..."))}`,
		0,
		0,
	);
}

export function renderTeamMessageCall(
	action: unknown,
	to: unknown,
	theme: Pick<Theme, "fg" | "bold">,
): Text {
	return renderTeamCall(
		`${String(action ?? "...")} ${String(to ?? "")}`.trim(),
		theme,
		"TeamMessage",
	);
}

interface ResultShape {
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
	details?: unknown;
}

export function renderTeamResult(
	result: ResultShape,
	expanded: boolean,
	theme: Pick<Theme, "fg" | "bold">,
	label = "Team",
): Text {
	const body = result.content[0];
	const text = body?.type === "text" && body.text ? body.text : "(no output)";
	const details = result.details as { error?: string } | undefined;
	if (result.isError || details?.error) {
		return new Text(
			`${theme.fg("error", `✗ ${label}`)} ${theme.fg("dim", short(text, 200))}`,
			0,
			0,
		);
	}
	const first = text.split("\n")[0] ?? "";
	const head = `${theme.fg("success", `✓ ${label}`)} ${theme.fg("dim", short(first, 120))}`;
	return new Text(expanded ? `${head}\n${theme.fg("dim", short(text, 500))}` : head, 0, 0);
}

export function renderTeamMessageResult(
	result: ResultShape,
	expanded: boolean,
	theme: Pick<Theme, "fg" | "bold">,
): Text {
	return renderTeamResult(result, expanded, theme, "TeamMessage");
}
