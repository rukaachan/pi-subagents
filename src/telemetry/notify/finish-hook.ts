/**
 * pi-subagents: the command run once when a leg finishes.
 */

import { spawn, type ChildProcess } from "node:child_process";

export const FINISH_HOOK_TIMEOUT_MS = 5000;
export const MAX_COMMAND_CHARS = 1000;
const MAX_ERROR_CHARS = 300;
export const MAX_REPORT_CHARS = 2_000;

export interface FinishPayload {
	event: "subagent_end";
	task_id: string;
	subagent: string;
	status: "done" | "error" | "interrupted";
	ms: number;
	chars: number;
	model?: string;
	cwd: string;
	error?: string;
	report?: string;
}

export function finishPayload(input: Omit<FinishPayload, "event">): FinishPayload {
	const { error: raw, report: rawReport, ...rest } = input;
	const error = raw?.replace(/\s+/g, " ").trim();
	const report = rawReport?.trim();
	return {
		...rest,
		event: "subagent_end",
		...(error
			? {
					error:
						error.length <= MAX_ERROR_CHARS ? error : `${error.slice(0, MAX_ERROR_CHARS - 1)}…`,
				}
			: {}),
		...(report
			? {
					report:
						report.length <= MAX_REPORT_CHARS
							? report
							: `${report.slice(0, MAX_REPORT_CHARS - 1)}…`,
				}
			: {}),
	};
}

/**
 * Fire and forget: one JSON line to stdin, never a reason to fail a run.
 * Returns the child so a test can await exit; production ignores it.
 */
export function runFinishHook(
	command: string,
	payload: FinishPayload,
	timeoutMs = FINISH_HOOK_TIMEOUT_MS,
): ChildProcess | undefined {
	const cmd = command.trim();
	if (!cmd || cmd.length > MAX_COMMAND_CHARS) return undefined;
	let child: ChildProcess;
	try {
		child = spawn(cmd, {
			shell: true,
			detached: true,
			windowsHide: true,
			stdio: ["pipe", "ignore", "ignore"],
			env: { ...process.env, PI_SUBAGENTS_EVENT: payload.event },
		});
	} catch {
		return undefined;
	}
	const timer = setTimeout(() => {
		try {
			child.kill("SIGKILL");
		} catch {
			/* already gone */
		}
	}, timeoutMs);
	timer.unref?.();
	child.on("exit", () => clearTimeout(timer));
	child.on("error", () => clearTimeout(timer));
	child.stdin?.on("error", () => {
		/* the command may not read stdin */
	});
	try {
		child.stdin?.end(`${JSON.stringify(payload)}\n`);
	} catch {
		/* the command may already be gone */
	}
	child.unref();
	return child;
}
