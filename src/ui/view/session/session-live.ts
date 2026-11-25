/**
 * pi-subagents: the live tail behind the transcript screen.
 */

import { fingerprint } from "./transcript-cursor.ts";

export interface LiveStream {
	schedule(): void;
	clear(): void;
	flush(): void;
}

export interface LiveDeps {
	source: () => readonly unknown[];
	stats: () => string;
	render: () => void;
	refresh: (messages: readonly unknown[]) => void;
	added: (count: number) => void;
	stream: LiveStream;
	subscribe?: (fn: (type: string) => void) => () => void;
	poll?: boolean;
	alive?: () => boolean;
	closed: () => boolean;
}

export interface LiveTail {
	tick(): void;
	sync(): void;
	dispose(): void;
}

const POLL_MS = 1000;

export function createLiveTail(deps: LiveDeps): LiveTail {
	let lastPrint = fingerprint(deps.source());
	let lastCount = deps.source().length;
	let lastStats = deps.stats();
	let pullTimer: ReturnType<typeof setTimeout> | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let unsubscribe: (() => void) | undefined;

	function pullNow(): void {
		const messages = deps.source();
		const print = fingerprint(messages);
		if (print !== lastPrint) {
			lastPrint = print;
			deps.added(Math.max(0, messages.length - lastCount));
			lastCount = messages.length;
			deps.refresh(messages);
			deps.render();
			return;
		}
		const stats = deps.stats();
		if (stats !== lastStats) {
			lastStats = stats;
			deps.render();
		}
	}

	function schedulePull(): void {
		if (deps.closed() || pullTimer !== undefined) return;
		pullTimer = setTimeout(() => {
			pullTimer = undefined;
			if (deps.closed()) return;
			try {
				pullNow();
			} catch {
				/* the viewer never breaks a run */
			}
		}, 0);
	}

	function onEvent(type: string): void {
		try {
			if (type === "message_update") {
				deps.stream.schedule();
				return;
			}
			if (type === "message_end") {
				deps.stream.clear();
				schedulePull();
				return;
			}
			if (type === "turn_end" || type === "agent_end") schedulePull();
		} catch {
			/* the viewer never breaks a run */
		}
	}

	unsubscribe = deps.subscribe?.(onEvent);

	function tick(): void {
		if (deps.closed()) return;
		if (deps.alive && !deps.alive()) stopTick();
		pullNow();
	}

	function stopTick(): void {
		if (timer === undefined) return;
		clearInterval(timer);
		timer = undefined;
	}

	if (deps.poll) timer = setInterval(tick, POLL_MS);

	return {
		tick,
		sync(): void {
			if (deps.closed()) return;
			if (pullTimer !== undefined) clearTimeout(pullTimer);
			pullTimer = undefined;
			deps.stream.flush();
			tick();
		},
		dispose(): void {
			stopTick();
			if (pullTimer !== undefined) clearTimeout(pullTimer);
			pullTimer = undefined;
			unsubscribe?.();
			unsubscribe = undefined;
		},
	};
}
