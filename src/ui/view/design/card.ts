/**
 * pi-subagents: one calm rounded card per run or team task.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { paint, statusStyle, type Tone, type UiTheme } from "./tokens.ts";

export const CARD_HEIGHT = 4;

export interface CardSpec {
	width: number;
	theme: UiTheme;
	title: string;
	meta?: string;
	subtitle?: string;
	detail?: string;
	detailTone?: Tone;
	status?: string;
	tone?: Tone;
	glyph?: string;
	selected?: boolean;
}

export function cardWidth(width: number): number {
	return Math.max(12, Math.min(width - 3, 100));
}

function row(content: string, inner: number, border: Tone, theme: UiTheme): string {
	const clipped = truncateToWidth(content, inner, "…");
	const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
	return paint(theme, border, "│") + " " + clipped + pad + " " + paint(theme, border, "│");
}

export function cardLines(spec: CardSpec): string[] {
	const width = cardWidth(spec.width);
	const inner = width - 4;
	const selected = spec.selected === true;
	const border: Tone = selected ? "accent" : "borderMuted";
	const style = statusStyle(spec.status);
	const glyph = spec.glyph ?? style.glyph;
	const tone = spec.tone ?? style.tone;
	const marker = selected ? paint(spec.theme, "accent", "› ") : "  ";
	const meta = spec.meta ?? "";
	const metaWidth = visibleWidth(meta);
	const room = Math.max(1, inner - 4 - (metaWidth > 0 ? metaWidth + 1 : 0));
	const title = truncateToWidth(spec.title, room, "…");
	const titleText = selected ? paint(spec.theme, "accent", title) : title;
	const headLeft = marker + paint(spec.theme, tone, glyph) + " " + titleText;
	const used = 4 + visibleWidth(title) + (metaWidth > 0 ? metaWidth + 1 : 0);
	const gap = Math.max(1, inner - used);
	const head =
		metaWidth > 0 ? headLeft + " ".repeat(gap) + paint(spec.theme, "dim", meta) : headLeft;
	const subtitle = spec.subtitle ? "    " + paint(spec.theme, "dim", spec.subtitle) : "";
	const detail = spec.detail
		? "    " + paint(spec.theme, spec.detailTone ?? "muted", spec.detail)
		: undefined;
	const top = paint(spec.theme, border, "╭" + "─".repeat(Math.max(1, width - 2)) + "╮");
	const bottom = paint(spec.theme, border, "╰" + "─".repeat(Math.max(1, width - 2)) + "╯");
	const lines = [
		" " + top,
		" " + row(head, inner, border, spec.theme),
		" " + row(subtitle, inner, border, spec.theme),
	];
	if (detail !== undefined) lines.push(" " + row(detail, inner, border, spec.theme));
	lines.push(" " + bottom);
	return lines;
}
