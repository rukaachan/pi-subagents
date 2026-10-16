/**
 * pi-subagents: the run guards.
 */
import { systemClock, turnInputTokens } from "./budget.ts";
import type { BudgetClock, BudgetStop } from "./budget.ts";
import { HARD_STOP_GRACE_MS, WIND_DOWN_SEC } from "./wind.ts";
import type { SubagentBudget } from "../../domain/subagent/budget.ts";

export function abandonedNote(graceMs: number = HARD_STOP_GRACE_MS): string {
	const secs = Math.max(1, Math.round(graceMs / 1000));
	return `the child did not stop after the guard fired; its session was disposed ${secs}s later.`;
}

/** Liveness floor: 2.3x the longest legitimate pause. */
export const STALL_SEC = 900;

export function installRunBudget(
	session: {
		subscribe(listener: (event: { type: string }) => void): () => void;
		/** pi's AgentSession.abort() is async; it resolves when idle. */
		abort(): void | Promise<void>;
		isIdle?: boolean;
	},
	budget: SubagentBudget | undefined,
	clock: BudgetClock = systemClock,
	stallSec: number = STALL_SEC,
	windDownSec: number = WIND_DOWN_SEC,
): BudgetStop {
	const turnsAllowed = budget?.maxTurns && budget.maxTurns > 0 ? budget.maxTurns : undefined;
	let inputAllowed =
		budget?.maxInputTokens && budget.maxInputTokens > 0 ? budget.maxInputTokens : undefined;
	const timeoutSec = budget?.timeoutSec && budget.timeoutSec > 0 ? budget.timeoutSec : undefined;
	let completed = 0;
	let turnsLeft = turnsAllowed;
	let inputSeen = 0;
	let timedOut = false;
	let elapsedSec = 0;
	let stalled = false;
	let stalledSec = 0;
	let firedAtSec = 0;
	let finished = false;
	let onWindDown: ((secsLeft: number) => void) | undefined;
	let onFire: (() => void) | undefined;
	const firedOnce = new Promise<void>((resolve) => {
		onFire = resolve;
	});
	let lastEventAt = clock.now();
	const stall = { cancel: (): void => undefined, armedAt: Number.NEGATIVE_INFINITY };
	const startedAt = clock.now();
	const secondsSinceStart = (): number => Math.max(1, Math.round((clock.now() - startedAt) / 1000));
	// abort() is async in pi and only resolves at idle.
	const abortRun = (): void => {
		onFire?.();
		onFire = undefined;
		if (finished || session.isIdle === true) return;
		try {
			void Promise.resolve(session.abort()).catch(() => undefined);
		} catch {
			// abort() throwing cannot help the caller; the note still reports.
		}
	};
	const armWindDown = timeoutSec !== undefined && windDownSec > 0 && timeoutSec >= windDownSec * 3;
	const cancelWind = armWindDown
		? clock.schedule(
				() => {
					if (finished || timedOut || stalled || session.isIdle === true) return;
					onWindDown?.(windDownSec);
				},
				(timeoutSec - windDownSec) * 1000,
			)
		: () => undefined;
	const cancelTimer = timeoutSec
		? clock.schedule(() => {
				if (finished || session.isIdle === true) return;
				timedOut = true;
				firedAtSec = secondsSinceStart();
				elapsedSec = firedAtSec;
				abortRun();
			}, timeoutSec * 1000)
		: () => undefined;

	function scheduleStall(ms: number): void {
		stall.cancel();
		stall.cancel = clock.schedule(() => {
			// Same honesty rule as the timeout: a settled run is not
			// stalled, and isIdle is false for a whole agent run (it
			// spans turns), so this cannot mask a live run.
			if (finished || session.isIdle === true) return;
			const silentMs = clock.now() - lastEventAt;
			if (silentMs < stallSec * 1000) {
				scheduleStall(stallSec * 1000 - silentMs);
				return;
			}
			stalled = true;
			stalledSec = Math.max(1, Math.round(silentMs / 1000));
			firedAtSec = secondsSinceStart();
			abortRun();
		}, ms);
	}
	const armStall = (): void => {
		if (finished || stallSec <= 0) return;
		const now = clock.now();
		if (now - stall.armedAt < 5_000) return;
		stall.armedAt = now;
		scheduleStall(stallSec * 1000);
	};
	armStall();

	const unsubscribe = session.subscribe((event) => {
		lastEventAt = clock.now();
		armStall();
		if (event.type !== "turn_end") return;
		completed += 1;
		let tripped = false;
		if (turnsAllowed !== undefined && turnsLeft !== undefined) {
			turnsLeft -= 1;
			if (turnsLeft === 0) tripped = true;
		}
		const turnInput = turnInputTokens(event);
		if (inputAllowed !== undefined && turnInput !== undefined) {
			inputSeen += turnInput;
			inputAllowed -= turnInput;
			if (inputAllowed <= 0) tripped = true;
		}
		// A late timer must not extend the deadline: re-check the clock
		// at every boundary so the cap holds even when the event loop
		// was busy for longer than the remaining time.
		if (timeoutSec !== undefined && !timedOut) {
			const secs = (clock.now() - startedAt) / 1000;
			if (secs >= timeoutSec) {
				timedOut = true;
				elapsedSec = Math.round(secs);
				tripped = true;
			}
		}
		if (tripped) abortRun();
	});

	const turnsSpent = () => turnsAllowed !== undefined && (turnsLeft ?? 1) <= 0;
	const inputSpent = () => inputAllowed !== undefined && inputAllowed <= 0;
	return {
		spent: () => turnsSpent() || inputSpent() || timedOut || stalled,
		fired: () => turnsSpent() || inputSpent() || timedOut || stalled,
		whenFired: () => firedOnce,
		windDown: (cb) => {
			onWindDown = cb;
		},
		note: () => {
			const parts: string[] = [];
			if (stalled) {
				parts.push(
					`stalled: no session event in ${stalledSec}s; the run was aborted at ${firedAtSec || secondsSinceStart()}s.`,
				);
			}
			if (timedOut && timeoutSec !== undefined) {
				parts.push(`timeout ${timeoutSec}s reached: the run was aborted after ${elapsedSec}s.`);
			}
			if (turnsSpent() && turnsAllowed !== undefined) {
				parts.push(`turn budget ${turnsAllowed} reached: run stopped after ${completed} turns.`);
			}
			if (inputSpent() && budget?.maxInputTokens) {
				parts.push(
					`input budget ${budget.maxInputTokens} reached: run stopped after ${inputSeen.toLocaleString("en-US")} prompt tokens (cached reads included).`,
				);
			} else if (budget?.maxInputTokens && inputSeen === 0 && completed > 0) {
				parts.push(
					`input budget ${budget.maxInputTokens} idle: the provider reported no usage in ${completed} turn${completed === 1 ? "" : "s"}.`,
				);
			}
			return parts.length > 0 ? parts.join(" ") : null;
		},
		dispose: () => {
			finished = true;
			cancelTimer();
			cancelWind();
			stall.cancel();
			unsubscribe();
		},
	};
}
