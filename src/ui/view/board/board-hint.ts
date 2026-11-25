/**
 * pi-subagents: the footer keys for the selected run.
 */

import type { BoardRow } from "./board-model.ts";

/** The keys that act on the row, in one shared order. */
export function actionKeys(row: BoardRow | undefined): string[] {
	const parts: string[] = [];
	if (row?.openable) parts.push("enter open");
	if (row?.steerable) parts.push("s steer");
	if (row?.stoppable) parts.push("x stop");
	if (row?.retryable) parts.push("r retry");
	if (row) parts.push("c copy");
	return parts;
}

export interface HiddenRows {
	failed: number;
	stopped: number;
	hidden: boolean;
}

export function boardHint(rows: readonly BoardRow[], cursor: number, hidden?: HiddenRows): string {
	const total = hidden ? hidden.failed + hidden.stopped : 0;
	const toggle = total > 0 ? [hidden?.hidden ? `e show ${total} hidden` : "e hide hidden"] : [];
	const parts = ["↑↓", ...actionKeys(rows[cursor]), ...toggle, "f finish", "tab", "esc"];
	parts.push(rows.length === 0 ? "0/0" : `${cursor + 1}/${rows.length}`);
	return parts.join(" · ");
}
