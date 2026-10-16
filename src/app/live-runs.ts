/**
 * pi-subagents: every child session that is alive right now.
 */

/** What a stop request needs from a session. Host sessions fit as-is. */
export interface StoppableSession {
	abort(): unknown;
	dispose(): void;
}

export interface LiveRun {
	id: string;
	label: string;
	stop: (why: string) => void;
}

const live = new Map<string, LiveRun>();

export function registerLive(id: string, label: string, stop: (why: string) => void): () => void {
	live.set(id, { id, label, stop });
	let done = false;
	return () => {
		if (done) return;
		done = true;
		if (live.get(id)?.stop === stop) live.delete(id);
	};
}

export function liveLabels(): string[] {
	return [...live.values()].map((run) => run.label);
}

export function liveCount(): number {
	return live.size;
}

// Stop every live run now.
export function stopLiveRuns(why: string): string[] {
	const runs = [...live.values()];
	live.clear();
	const stopped: string[] = [];
	for (const run of runs) {
		try {
			run.stop(why);
			stopped.push(run.label);
		} catch {
			/* a wedged run must not block the others */
		}
	}
	return stopped;
}

export interface LiveStop {
	stop: (why: string) => void;
	unregister: () => void;
	wasStopped: () => boolean;
	/** Why it stopped, or "" when it never did. */
	why: () => string;
}

// Wire one child session to the registry.
export function liveStop(
	id: string,
	label: string,
	session: StoppableSession,
	book: (why: string) => void,
): LiveStop {
	let why = "";
	const stop = (reason: string) => {
		if (why) return;
		why = reason;
		try {
			book(reason);
		} catch {}
		try {
			void session.abort();
		} catch {}
		try {
			session.dispose();
		} catch {}
	};
	return {
		stop,
		unregister: registerLive(id, label, stop),
		wasStopped: () => why !== "",
		why: () => why,
	};
}
