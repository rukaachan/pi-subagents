/**
 * pi-subagents: the live team board for one Pi session.
 */

import type { PersistedTeam } from "../infra/state-team.ts";
import type { TeamApi } from "../infra/team-tool-types.ts";
import {
	LEAD_NAME,
	MAX_TEAM_MEMBERS,
	createTeamTask,
	liveTasks,
	newTeam,
	teamView,
	type TeamBoard,
	type TeamCaller,
	type TeamMember,
	type TeamFilters,
	type TeamResult,
	type TeamTaskView,
	type TeamUpdate,
} from "../domain/team/index.ts";
import { updateTeamTask } from "../domain/team/index.ts";
import { resolveTaskOn, summarizeBoard, taskListOn } from "./team-read.ts";
import { journalTeamTask } from "./team-journal.ts";

interface TeamState {
	enabled: boolean;
	board: TeamBoard;
	members: TeamMember[];
}

let state: TeamState | null = null;
let changeHook: (() => void) | null = null;

function notify(): void {
	try {
		changeHook?.();
	} catch {
		/* the hook never throws back */
	}
}

function fresh(teamId: string): TeamState {
	return { enabled: false, board: newTeam(teamId), members: [] };
}

export function beginTeamSession(teamId: string): void {
	state = fresh(teamId);
}

export function setTeamChangeHook(fn: (() => void) | null): void {
	changeHook = fn;
}

function current(): TeamState {
	state ??= fresh("local");
	return state;
}

export function teamEnabled(): boolean {
	return current().enabled;
}

/** The board stays writable after /subagents team off so a claimed task can finish. */
export function teamActive(): boolean {
	const team = current();
	return team.enabled || liveTasks(team.board).length > 0;
}

export function currentTeamId(): string {
	return current().board.teamId;
}

export function enableTeam(teamId?: string): void {
	const next = current();
	if (teamId && teamId !== next.board.teamId && next.board.tasks.length === 0) {
		state = { ...fresh(teamId), enabled: true };
	} else {
		next.enabled = true;
	}
	notify();
}

export function disableTeam(): void {
	current().enabled = false;
	notify();
}

export function teamMembers(): TeamMember[] {
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
export function joinTeam(starter: string, key?: string, now = Date.now()): string {
	const team = current();
	if (key) {
		const known = team.members.find((member) => member.key === key);
		if (known) return known.name;
	}
	const base = baseName(starter);
	const reserved = new Set(
		liveTasks(team.board)
			.filter((task) => task.status === "pending" || task.status === "in_progress")
			.flatMap((task) => (task.owner ? [task.owner] : [])),
	);
	if (team.members.length >= MAX_TEAM_MEMBERS) {
		const idle = team.members.findIndex((member) => !reserved.has(member.name));
		if (idle < 0) {
			throw new Error(`Team is full: all ${MAX_TEAM_MEMBERS} members own live tasks.`);
		}
		team.members.splice(idle, 1);
	}
	const used = new Set([
		...team.members.map((member) => member.name),
		...team.board.tasks.flatMap((task) => (task.owner ? [task.owner] : [])),
	]);
	let name = base;
	for (let n = 2; used.has(name); n += 1) name = `${base}-${n}`;
	team.members.push({ name, starter, joinedAt: now, ...(key ? { key } : {}) });
	return name;
}

export function teamBoard(): TeamBoard {
	return current().board;
}

/** Tell the persistence hook the board changed. */
export function teamChanged(): void {
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
): TeamResult {
	const result = createTeamTask(current().board, input);
	journalTeamTask({
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

export function updateTask(update: TeamUpdate, caller: TeamCaller): TeamResult {
	const team = current();
	const result = updateTeamTask(team.board, update, caller, team.members);
	journalTeamTask({
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

export function taskList(filters: TeamFilters = {}): TeamTaskView[] {
	return taskListOn(current().board, filters);
}

export function getTask(taskId: string): TeamTaskView | undefined {
	const board = current().board;
	const task = board.tasks.find((row) => row.id === taskId);
	return task?.status === "deleted" ? undefined : task ? teamView(task, board) : undefined;
}

export function resolveTask(taskId: string) {
	return resolveTaskOn(current().board, taskId);
}

export function teamSummary(): { teamId: string; enabled: boolean; open: number; done: number } {
	const team = current();
	return summarizeBoard(team.board, team.enabled);
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

export function teamSnapshot(): PersistedTeam | undefined {
	if (!state) return undefined;
	return {
		teamId: state.board.teamId,
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

export function restoreTeam(snapshot: PersistedTeam): void {
	state = {
		enabled: snapshot.enabled,
		board: { teamId: snapshot.teamId, nextId: snapshot.nextId, tasks: snapshot.tasks },
		members: snapshot.members,
	};
}

export const teamApi: TeamApi = {
	active: teamActive,
	teamId: currentTeamId,
	summary: teamSummary,
	members: teamMembers,
	create: createTask,
	update: updateTask,
	list: taskList,
	get: getTask,
	resolve: resolveTask,
};
