/**
 * pi-subagents: tool result rendering.
 */

import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { shortText, usageLine } from "./view/format.ts";
import { toUsage } from "../infra/host-usage.ts";

export { toUsage };

export function resultShell(
	theme: Theme,
	head: string,
	body: string,
	cutAt: number,
	collapsedAt: number,
	expanded: boolean,
) {
	if (!expanded)
		return new Text(`${head}\n${theme.fg("toolOutput", shortText(body, collapsedAt))}`, 0, 0);
	const box = new Container();
	box.addChild(new Text(head, 0, 0));
	box.addChild(new Spacer(1));
	box.addChild(
		new Markdown(
			body.length > cutAt ? `${body.slice(0, cutAt)}\n…(cut, full text is in context)` : body,
			0,
			0,
			getMarkdownTheme(),
		),
	);
	return box;
}

export function usageFooter(
	theme: Theme,
	usage?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		turns: number;
	},
	model?: string,
): string {
	const line = usage ? usageLine(usage, model) : "";
	return line ? theme.fg("dim", ` ── ${line}`) : "";
}
