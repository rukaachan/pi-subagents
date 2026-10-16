/**
 * pi-subagents: the Esc watcher.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import { isModalOpen } from "./modal-depth.ts";

/** What the watcher needs from the UI. Host UI satisfies it as-is. */
export interface EscWatchPort {
	onTerminalInput(
		handler: (data: string) => { consume?: boolean; data?: string } | undefined,
	): () => void;
	notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface EscWatchActions {
	hasLive: () => boolean;
	stopAll: () => string;
}

export function watchEscapeKey(ui: EscWatchPort, actions: EscWatchActions): () => void {
	return ui.onTerminalInput((data) => {
		if (!matchesKey(data, "escape")) return undefined;
		if (isModalOpen()) return undefined;
		if (!actions.hasLive()) return undefined;
		try {
			const notice = actions.stopAll();
			if (notice) ui.notify(notice, "info");
		} catch {
			/* a stop request must never break typing */
		}
		// Never consume: pi's own interrupt still has to run.
		return undefined;
	});
}
