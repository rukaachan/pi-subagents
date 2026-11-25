/**
 * pi-subagents: the live team board for one Pi session.
 */

import type { PersistedAgentTeam } from "../../../infra/state/index.ts";
import type { AgentTeamApi } from "../../../infra/agent-team/tools/index.ts";
import {
	LEAD_NAME,
	MAX_AGENT_TEAM_MEMBERS,
	createAgentTeamTask,
	liveTasks,
	newAgentTeam,
	agentTeamView,
	type AgentTeamBoard,
	type AgentTeamCaller,
	type AgentTeamMember,
	type AgentTeamFilters,
	type AgentTeamResult,
	type AgentTeamTaskView,
	type AgentTeamUpdate,
} from "../../../domain/agent-team/index.ts";
import { updateAgentTeamTask } from "../../../domain/agent-team/index.ts";
import { resolveTaskOn, summarizeBoard, taskListOn } from "./agent-team-read.ts";
import { journalAgentTeamTask } from "./agent-team-journal.ts";

interface AgentTeamState {
	enabled: boolean;
	board: AgentTeamBoard;
	members: AgentTeamMember[];
}

let state: AgentTeamState | null = null;
let changeHook: (() => void) | null = null;

function notify(): void {
	try {
		changeHook?.();
	} catch {
		/* the hook never throws back */
	}
}

function fresh(agentTeamId: string): AgentTeamState {
	return { enabled: false, board: newAgentTeam(agentTeamId), members: [] };
}

export function beginAgentTeamSession(agentTeamId: string): void {
	state = fresh(agentTeamId);
}

export function setAgentTeamChangeHook(fn: (() => void) | null): void {
	changeHook = fn;
}

function current(): AgentTeamState {
	state ??= fresh("local");
	return state;
}

export function agentTeamEnabled(): boolean {
	return current().enabled;
}

/** The board stays writable after /subagents team off so a claimed task can finish. */
export function agentTeamActive(): boolean {
	const agentTeam = current();
	return agentTeam.enabled || liveTasks(agentTeam.board).length > 0;
}

export function currentAgentTeamId(): string {
	return current().board.agentTeamId;
}

export function enableAgentTeam(agentTeamId?: string): void {
	const next = current();
	if (agentTeamId && agentTeamId !== next.board.agentTeamId && next.board.tasks.length === 0) {
		state = { ...fresh(agentTeamId), enabled: true };
	} else {
		next.enabled = true;
	}
	notify();
}

export function disableAgentTeam(): void {
	current().enabled = false;
	notify();
}

export function agentTeamMembers(): AgentTeamMember[] {
	return [...current().members];
}

function baseName(starter: string): string {
	const clean = starter
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!clean || clean === LEAD_NAME) return "member";
	return clean.slice(0, 32);
}

/** Register one teammate and return its unique owner name. */
export function joinAgentTeam(starter: string, key?: string, now = Date.now()): string {
	const agentTeam = current();
	if (key) {
		const known = agentTeam.members.find((member) => member.key === key);
		if (known) return known.name;
	}
	const base = baseName(starter);
	const reserved = new Set(
		liveTasks(agentTeam.board)
			.filter((task) => task.status === "pending" || task.status === "in_progress")
			.flatMap((task) => (task.owner ? [task.owner] : [])),
	);
	if (agentTeam.members.length >= MAX_AGENT_TEAM_MEMBERS) {
		const idle = agentTeam.members.findIndex((member) => !reserved.has(member.name));
		if (idle < 0) {
			throw new Error(`Agent team is full: all ${MAX_AGENT_TEAM_MEMBERS} members own live tasks.`);
		}
		agentTeam.members.splice(idle, 1);
	}
	const used = new Set([
		...agentTeam.members.map((member) => member.name),
		...agentTeam.board.tasks.flatMap((task) => (task.owner ? [task.owner] : [])),
	]);
	let name = base;
	for (let n = 2; used.has(name); n += 1) name = `${base}-${n}`;
	agentTeam.members.push({ name, starter, joinedAt: now, ...(key ? { key } : {}) });
	return name;
}

export function agentTeamBoard(): AgentTeamBoard {
	return current().board;
}

/** Tell the persistence hook the board changed. */
export function agentTeamChanged(): void {
	notify();
}

export function createTask(
	input: {
		subject: string;
		description: string;
		blockedBy?: string[];
		writeScopes?: string[];
	},
	actor = "lead",
): AgentTeamResult {
	const result = createAgentTeamTask(current().board, input);
	journalAgentTeamTask({
		action: "create",
		taskId: result.ok ? result.task.id : "",
		revision: result.ok ? result.task.revision : 0,
		actor,
		ok: result.ok,
		...(result.ok ? {} : { error: result.error }),
	});
	if (result.ok) notify();
	return result;
}

export function updateTask(update: AgentTeamUpdate, caller: AgentTeamCaller): AgentTeamResult {
	const agentTeam = current();
	const result = updateAgentTeamTask(agentTeam.board, update, caller, agentTeam.members);
	journalAgentTeamTask({
		action: update.action,
		taskId: update.taskId,
		revision: getTask(update.taskId)?.task.revision ?? update.expectedRevision,
		actor: caller.name,
		ok: result.ok,
		...(result.ok ? {} : { error: result.error }),
	});
	if (result.ok) notify();
	return result;
}

export function taskList(filters: AgentTeamFilters = {}): AgentTeamTaskView[] {
	return taskListOn(current().board, filters);
}

export function getTask(taskId: string): AgentTeamTaskView | undefined {
	const board = current().board;
	const task = board.tasks.find((row) => row.id === taskId);
	return task?.status === "deleted" ? undefined : task ? agentTeamView(task, board) : undefined;
}

export function resolveTask(taskId: string) {
	return resolveTaskOn(current().board, taskId);
}

export function agentTeamSummary(): {
	agentTeamId: string;
	enabled: boolean;
	open: number;
	done: number;
} {
	const agentTeam = current();
	return summarizeBoard(agentTeam.board, agentTeam.enabled);
}

/** Attach the run that owns a task, without touching its revision. */
export function linkRun(taskId: string, runId: string): void {
	const task = current().board.tasks.find((row) => row.id === taskId);
	if (!task || task.status === "deleted") return;
	const clean = runId.trim().slice(0, 128);
	if (!clean || task.runId === clean) return;
	task.runId = clean;
	notify();
}

export function agentTeamSnapshot(): PersistedAgentTeam | undefined {
	if (!state) return undefined;
	return {
		agentTeamId: state.board.agentTeamId,
		enabled: state.enabled,
		nextId: state.board.nextId,
		tasks: state.board.tasks.map((task) => ({
			...task,
			blockedBy: [...task.blockedBy],
			writeScopes: [...task.writeScopes],
		})),
		members: state.members.map((member) => ({ ...member })),
	};
}

export function restoreAgentTeam(snapshot: PersistedAgentTeam): void {
	state = {
		enabled: snapshot.enabled,
		board: { agentTeamId: snapshot.agentTeamId, nextId: snapshot.nextId, tasks: snapshot.tasks },
		members: snapshot.members,
	};
}

export const agentTeamApi: AgentTeamApi = {
	active: agentTeamActive,
	agentTeamId: currentAgentTeamId,
	summary: agentTeamSummary,
	members: agentTeamMembers,
	create: createTask,
	update: updateTask,
	list: taskList,
	get: getTask,
	resolve: resolveTask,
};
