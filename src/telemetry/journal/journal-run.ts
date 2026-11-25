/**
 * pi-subagents: one folded journal run.
 */
import type { FailureFamily } from "../../domain/policy/index.ts";

export interface JournalRun {
	id: string;
	label: string;
	kind: string;
	runId?: string;
	startedAt: number;
	endedAt?: number;
	elapsedSec?: number;
	/** `interrupted`: a stop request (Esc, reload, quit) ended the run. */
	status: "running" | "done" | "error" | "interrupted";
	turns: number;
	tool?: string;
	reportChars?: number;
	promptChars?: number;
	inputTokens?: number;
	outputTokens?: number;
	cost?: number;
	model?: string;
	notes?: string[];
	error?: string;
	failure?: FailureFamily;
	compactions?: number;
	gapMaxSec?: number;
	gapOver60?: number;
	recent?: { tool: string; detail?: string }[];
	stale?: boolean;
}
