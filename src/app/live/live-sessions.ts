/**
 * pi-subagents: live child sessions, read-only.
 */

/** What the session viewer needs: the child's messages, right now. */
export interface LiveSessionView {
	messages: () => readonly unknown[];
	/** The assistant message still being written, if any. */
	streaming?: () => unknown;
	/** Observe child events; returns the unsubscribe. */
	subscribe?: (fn: (type: string) => void) => () => void;
	/** Queue a correction into the running child; resolves false when it could not. */
	steer?: (text: string) => Promise<boolean>;
}

const live = new Map<string, LiveSessionView>();

export function registerLiveSession(id: string, view: LiveSessionView): () => void {
	live.set(id, view);
	let done = false;
	return () => {
		if (done) return;
		done = true;
		if (live.get(id) === view) live.delete(id);
	};
}

export function liveSession(id: string): LiveSessionView | undefined {
	return live.get(id);
}

export function liveSessionCount(): number {
	return live.size;
}
