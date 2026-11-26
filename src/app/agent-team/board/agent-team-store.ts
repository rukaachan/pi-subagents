/**
 * pi-subagents: the live team board for one Pi session.
 */

import {
	LEAD_NAME,
	MAX_AGENT_TEAM_MEMBERS,
	liveTasks,
	newAgentTeam,
	agentTeamView,
	type AgentTeamBoard,
	type AgentTeamFilters,
	type AgentTeamMember,
	type AgentTeamRole,
	type AgentTeamTaskView,
} from "../../../domain/agent-team/index.ts";
import { resolveTaskOn, summarizeBoard, taskListOn } from "./agent-team-read.ts";

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

export function hasAgentTeamState(): boolean {
	return state !== null;
}

export function readAgentTeamState(): AgentTeamState {
	return current();
}

export function writeAgentTeamState(next: AgentTeamState): void {
	state = next;
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
export function joinAgentTeam(
	starter: string,
	key?: string,
	now = Date.now(),
	role: AgentTeamRole = "worker",
): string {
	const agentTeam = current();
	if (key) {
		const known = agentTeam.members.find((member) => member.key === key);
		if (known) {
			known.role = role;
			return known.name;
		}
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
	agentTeam.members.push({ name, starter, role, joinedAt: now, ...(key ? { key } : {}) });
	return name;
}

export function agentTeamBoard(): AgentTeamBoard {
	return current().board;
}

/** Tell the persistence hook the board changed. */
export function agentTeamChanged(): void {
	notify();
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
	review: number;
	done: number;
	facts: number;
} {
	const agentTeam = current();
	return summarizeBoard(agentTeam.board, agentTeam.enabled);
}
