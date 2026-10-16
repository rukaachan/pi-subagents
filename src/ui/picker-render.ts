/**
 * pi-subagents: laying out the picker.
 */

import { getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, visibleWidth } from "@earendil-works/pi-tui";
import { shortText } from "./view/format.ts";
import type { PickItem } from "./picker-types.ts";

export const KEY_UP = "\x1b[A";
export const KEY_DOWN = "\x1b[B";

const MIN_PRIMARY_WIDTH = 13;
const MAX_PRIMARY_WIDTH = 19;
const COLUMN_GAP = 2;
const PREFIX_WIDTH = 2;
const MIN_ROW_WIDTH = 40;

export function descriptionWidth(labels: string[], width: number): number {
	if (width <= MIN_ROW_WIDTH) return 0;
	const widest = labels.reduce((w, l) => Math.max(w, visibleWidth(l) + COLUMN_GAP), 0);
	const primary = Math.max(MIN_PRIMARY_WIDTH, Math.min(MAX_PRIMARY_WIDTH, widest));
	const effective = Math.max(1, Math.min(primary, width - PREFIX_WIDTH - 4));
	const maxPrimary = Math.max(1, effective - COLUMN_GAP);
	const labelWidth = labels.reduce((w, l) => Math.max(w, Math.min(visibleWidth(l), maxPrimary)), 0);
	const spacing = Math.max(1, effective - labelWidth);
	return Math.max(0, width - (PREFIX_WIDTH + labelWidth + spacing) - 2);
}

export function fitDescriptions(items: PickItem[], width: number): void {
	const room = descriptionWidth(
		items.map((i) => i.label),
		width,
	);
	for (const item of items) {
		if (item.description === undefined && item.fit === undefined) continue;
		item.fit ??= item.description;
		if (!item.fit) continue;
		item.description = room > 1 ? shortText(item.fit, room - 1) : undefined;
	}
}

export function buildPicker(
	items: PickItem[],
	_theme: Theme,
	opts: { maxVisible?: number; index?: number; width?: number } = {},
): { list: SelectList; container: Container } {
	fitDescriptions(items, opts.width ?? 100);
	const list = new SelectList(items, opts.maxVisible ?? 12, getSelectListTheme());
	list.setSelectedIndex(opts.index ?? 0);
	const container = new Container();
	container.addChild(list);
	return { list, container };
}

export function cutToWidth(text: string, width: number): string {
	if (width <= 0) return "";
	if (text.length <= width) return text;
	if (width === 1) return text.slice(0, 1);
	return `${text.slice(0, width - 1)}…`;
}

export function titleBlock(
	title: string,
	subtitle: string | undefined,
	body: string[] | undefined,
	theme: Theme,
): { node: Container; fit(width: number): void } {
	const head = new Container();
	head.addChild(new Text(theme.fg("accent", theme.bold(title)), 0, 0));
	if (subtitle) head.addChild(new Text(theme.fg("dim", subtitle), 0, 0));
	const rows = (body ?? []).map((line) => {
		const node = new Text(theme.fg("muted", line), 0, 0);
		head.addChild(node);
		return { node, line };
	});
	return {
		node: head,
		fit(width: number) {
			for (const { node, line } of rows) node.setText(theme.fg("muted", cutToWidth(line, width)));
		},
	};
}

// Pick one item.
