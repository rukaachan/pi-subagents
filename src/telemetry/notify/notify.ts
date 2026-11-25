/**
 * pi-subagents: one settle notice per finished background run.
 */

export const SETTLED_CUSTOM_TYPE = "pi-subagents:settled";

export type SettleStatus = "done" | "error" | "interrupted";

export interface SettleNotice {
	taskId: string;
	subagent: string;
	status: SettleStatus;
	elapsedMs: number;
	turns?: number;
	tokens?: number;
	cost?: number;
	model?: string;
	report?: string;
	error?: string;
	runId?: string;
	parentSessionId?: string;
	/** True when this notice carries the report body. */
	delivered?: boolean;
	/** Board tasks this run freed, or left claimed. */
	team?: { released: string[]; open: string[] };
}

export interface SettleDetails {
	taskId: string;
	subagent: string;
	status: SettleStatus;
	elapsedMs: number;
	turns: number;
	tokens: number;
	cost?: number;
	model?: string;
	reportChars: number;
	delivered: boolean;
	runId?: string;
	report?: string;
	error?: string;
	team?: { released: string[]; open: string[] };
}

export interface SettleMessage {
	content: string;
	details: SettleDetails;
}

export type NotifySink = (message: SettleMessage) => void;

let sink: NotifySink | null = null;
let sessionId: string | undefined;

export function setNotifySink(fn: NotifySink | null, session?: string): void {
	sink = fn;
	sessionId = session;
}

/** Clear the sink; a call for another session leaves the current one alone. */
export function clearNotifySink(session?: string): void {
	if (session !== undefined && sessionId !== undefined && session !== sessionId) return;
	sink = null;
	sessionId = undefined;
}

/** Deliver a settle notice. Returns true only when the sink took it. */
export function notifySettled(notice: SettleNotice): boolean {
	if (!sink) return false;
	if (
		sessionId !== undefined &&
		notice.parentSessionId !== undefined &&
		sessionId !== notice.parentSessionId
	) {
		return false;
	}
	const message = settleMessage(notice);
	try {
		sink(message);
		return true;
	} catch {
		return false;
	}
}

export function settleMessage(notice: SettleNotice): SettleMessage {
	const details: SettleDetails = {
		taskId: notice.taskId,
		subagent: notice.subagent,
		status: notice.status,
		elapsedMs: Math.max(0, Math.round(notice.elapsedMs)),
		turns: Math.max(0, notice.turns ?? 0),
		tokens: Math.max(0, notice.tokens ?? 0),
		reportChars: notice.report?.length ?? 0,
		delivered: notice.delivered === true,
		...(notice.cost !== undefined ? { cost: notice.cost } : {}),
		...(notice.model ? { model: notice.model } : {}),
		...(notice.runId ? { runId: notice.runId } : {}),
		...(notice.report ? { report: notice.report } : {}),
		...(notice.error ? { error: notice.error } : {}),
		...(notice.team && (notice.team.released.length || notice.team.open.length)
			? { team: notice.team }
			: {}),
	};

	const head = [
		`[subagent settled] ${notice.subagent}`,
		notice.taskId,
		`${label(notice.status)} in ${elapsed(notice.elapsedMs)}`,
	];
	if (details.turns > 0) head.push(`${details.turns} turns`);
	if (details.tokens > 0) head.push(tokens(details.tokens));
	const costText = money(details.cost);
	if (costText) head.push(costText);

	const body: string[] = [head.join(" · ")];
	const released = notice.team?.released ?? [];
	const open = notice.team?.open ?? [];
	if (released.length > 0) {
		body.push(
			"",
			`Released ${released.join(", ")}: the run did not finish, so it is pending again.`,
		);
	}
	if (open.length > 0) {
		body.push("", `Left ${open.join(", ")} in_progress. Complete it or release it.`);
	}
	if (notice.status === "done" && !details.delivered) {
		body.push("", "The full report was already delivered by TaskOutput. Do not poll again.");
	} else if (notice.status === "error") {
		body.push("", `Error: ${notice.error ?? "run failed"}`);
		body.push("", "The run is over. Do not poll TaskOutput for it.");
	} else if (notice.report && notice.report.trim()) {
		body.push("", "Report:", notice.report);
		body.push("", "This report is final. Do not poll TaskOutput for this task.");
	} else {
		body.push("", "(no output)");
	}

	return { content: body.join("\n"), details };
}

function label(status: SettleStatus): string {
	if (status === "error") return "ERROR";
	if (status === "interrupted") return "STOPPED";
	return "DONE";
}

function elapsed(ms: number): string {
	const sec = Math.max(0, Math.round(ms / 1000));
	if (sec < 60) return `${sec}s`;
	return `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}s`;
}

function tokens(n: number): string {
	if (n < 1000) return `${n} tok`;
	if (n < 1_000_000) return `${trim(n / 1000)}k tok`;
	return `${trim(n / 1_000_000)}M tok`;
}

function money(cost: number | undefined): string | undefined {
	if (cost === undefined || !Number.isFinite(cost) || cost <= 0) return undefined;
	if (cost < 0.001) return "<$0.001";
	return `$${cost.toFixed(3)}`;
}

function trim(n: number): string {
	return n.toFixed(1).replace(/\.0$/, "");
}
