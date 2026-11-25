/**
 * pi-subagents: waiting on a team member without blocking the host.
 */

import { capDelivery } from "../../../domain/run/index.ts";
import type { WaitOutcome } from "../../../domain/team/index.ts";
import { LEAD_NAME, type TeamMember } from "../../../domain/team/index.ts";
import type { TaskRecord } from "../../../domain/task/index.ts";
import type { TaskStore } from "../../../domain/task/index.ts";

export const MAX_WAIT_MS = 120_000;

interface WaitEdge {
	from: string;
	to: string;
}

export interface WaitTarget {
	runId?: string;
	chain?: boolean;
}

export interface WaitDeps {
	target: WaitTarget | undefined;
	tasks: TaskStore | undefined;
	members: () => TeamMember[];
}

const waits = new Set<WaitEdge>();

export function clearWaits(): void {
	waits.clear();
}

function settled(row: TaskRecord): WaitOutcome | undefined {
	if (row.status === "running") return undefined;
	return {
		kind: "settled",
		taskId: row.taskId,
		status: row.status,
		report: capDelivery(row.result?.text ?? ""),
		...(row.error ? { error: row.error } : {}),
	};
}

function coldError(name: string, members: () => TeamMember[]): string {
	return members().some((row) => row.name === name)
		? `${name} is not running. Read its settle card or use TaskOutput.`
		: `No member named "${name}".`;
}

function coldWait(name: string, deps: WaitDeps): WaitOutcome {
	const known = deps.members().find((row) => row.name === name);
	if (!known?.key || !deps.tasks) return { kind: "failed", error: coldError(name, deps.members) };
	const row = deps.tasks.get(known.key);
	if (!row) return { kind: "failed", error: coldError(name, deps.members) };
	const out = settled(row);
	if (out) return out;
	return { kind: "failed", error: `${name} has no live process; last row still running.` };
}

function cyclePath(sender: string, target: string): string[] | undefined {
	const seen = new Set<string>();
	const walk = (node: string, path: string[]): string[] | undefined => {
		if (node === sender) return [...path, node];
		if (seen.has(node)) return undefined;
		seen.add(node);
		for (const edge of waits) {
			if (edge.from !== node) continue;
			const found = walk(edge.to, [...path, node]);
			if (found) return found;
		}
		return undefined;
	};
	return walk(target, [sender]);
}

function waitCycleError(sender: string, target: string, path: string[]): string {
	let next = sender;
	for (const edge of waits) {
		if (edge.from === target) {
			next = edge.to;
			break;
		}
	}
	return `${sender} cannot wait on ${target}: ${target} is already waiting on ${next} (deadlock: ${path.join(" -> ")}).`;
}

export async function waitForMemberCore(
	from: string | undefined,
	to: string,
	deps: WaitDeps,
	timeoutMs = MAX_WAIT_MS,
): Promise<WaitOutcome> {
	const sender = from?.trim() || LEAD_NAME;
	const target = to.trim();
	if (!target) return { kind: "failed", error: "A wait needs a member name." };
	if (target === LEAD_NAME) return { kind: "failed", error: "The lead has no run row to wait on." };
	if (target === sender) return { kind: "failed", error: "You cannot wait on yourself." };
	const member = deps.target;
	if (!member) return coldWait(target, deps);
	if (member.chain)
		return {
			kind: "failed",
			error: `${target} runs inside a chain; wait is not available. Read the chain report when it settles.`,
		};
	if (!member.runId)
		return { kind: "failed", error: `${target} has no run row yet. Try TaskOutput.` };
	if (!deps.tasks) return { kind: "failed", error: "The task store is not ready." };
	const store = deps.tasks;
	const runId = member.runId;
	const first = store.get(runId);
	if (!first) return { kind: "failed", error: `${target} has no run row yet. Try TaskOutput.` };
	const done = settled(first);
	if (done) return done;
	const path = cyclePath(sender, target);
	if (path) return { kind: "failed", error: waitCycleError(sender, target, path) };
	const edge: WaitEdge = { from: sender, to: target };
	waits.add(edge);
	const waitMs = Math.min(Math.max(1, timeoutMs), MAX_WAIT_MS);
	const started = Date.now();
	return new Promise<WaitOutcome>((resolve) => {
		let finished = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (out: WaitOutcome) => {
			if (finished) return;
			finished = true;
			waits.delete(edge);
			if (timer) clearTimeout(timer);
			off();
			resolve(out);
		};
		const check = () => {
			const row = store.get(runId);
			const out = row ? settled(row) : undefined;
			if (out) finish(out);
		};
		const off = store.subscribe(check);
		timer = setTimeout(
			() => finish({ kind: "running", taskId: runId, waitedMs: Date.now() - started }),
			waitMs,
		);
		check();
	});
}
