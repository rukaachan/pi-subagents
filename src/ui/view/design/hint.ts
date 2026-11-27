/**
 * pi-subagents: one quiet line of keys at the foot of a screen.
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import { paint, type UiTheme } from "./tokens.ts";

export function fitHint(hint: string, width: number, theme: UiTheme): string {
	const line = truncateToWidth(hint, Math.max(1, width - 1), "…");
	return " " + paint(theme, "dim", line);
}
