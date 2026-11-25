/**
 * pi-subagents: the message contract between live team members.
 */

export const MAX_COLD_MESSAGES = 8;
export const MAX_COLD_CHARS = 8_000;

export interface MailResult {
	ok: boolean;
	error?: string;
	chars?: number;
	truncated?: boolean;
	queued?: boolean;
}

export type WaitOutcome =
	| {
			kind: "settled";
			taskId: string;
			status: "done" | "error" | "stopped";
			report: string;
			error?: string;
	  }
	| { kind: "running"; taskId: string; waitedMs: number }
	| { kind: "failed"; error: string };

export interface TeamMessageApi {
	send: (from: string | undefined, to: string, text: string) => MailResult;
	wait: (from: string | undefined, to: string, timeoutMs?: number) => Promise<WaitOutcome>;
}
