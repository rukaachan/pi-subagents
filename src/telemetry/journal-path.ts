/**
 * pi-subagents: where the run journal lives, and what it holds.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export const JOURNAL_MAX_BYTES = 2_000_000;

export type JournalEvent =
	| { event: "run_start"; id: string; label: string; kind: string; cwd?: string; run?: string }
	| { event: "turn"; id: string; turns: number; tool?: string }
	| {
			event: "tool";
			id: string;
			tool: string;
			turns: number;
			detail?: string;
			nested?: string;
	  }
	| { event: "failure"; id: string; family: string; auto?: boolean }
	| {
			event: "retry";
			id: string;
			attempt: number;
			delayMs?: number;
			reason?: string;
			error?: string;
	  }
	| { event: "state_error"; message: string }
	| { event: "steer"; id: string; text: string }
	| { event: "team_message"; from: string; to: string; chars: number; queued?: boolean }
	| { event: "gate"; tool: string; reason: string }
	| {
			event: "team_task";
			action: string;
			taskId: string;
			revision: number;
			actor: string;
			ok: boolean;
			error?: string;
	  }
	| { event: "stop"; id: string; family: string; why?: string }
	| {
			event: "compact";
			id: string;
			turns: number;
			reason: string;
			tokensBefore: number;
			tokensAfter?: number;
			aborted?: boolean;
	  }
	| {
			event: "run_end";
			id: string;
			status: "done" | "error" | "interrupted";
			turns: number;
			elapsedSec: number;
			reportChars?: number;
			model?: string;
			error?: string;
			notes?: string[];
			gapMaxSec?: number;
			gapOver60?: number;
			run?: string;
	  };

export function defaultJournalPath(): string {
	return (
		process.env.PI_SUBAGENTS_JOURNAL ??
		join(homedir(), ".pi", "agent", "pi-subagents-journal.ndjson")
	);
}
