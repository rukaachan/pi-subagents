/**
 * pi-subagents: durable per-workspace facts, beside the state file.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	MAX_AGENT_TEAM_EXCLUDED,
	MAX_AGENT_TEAM_FACTS,
	type AgentTeamLedgerEntry,
} from "../../domain/agent-team/index.ts";
import { decodeLedger } from "./rows/index.ts";

export const WORKSPACE_LEDGER_FILE = "agent-team-ledger.json";
const VERSION = 1;
const MAX_WORKSPACES = 20;

interface WorkspaceRow {
	updatedAt: number;
	entries: AgentTeamLedgerEntry[];
}

interface LedgerFile {
	version: number;
	workspaces: Record<string, WorkspaceRow>;
}

export type WorkspaceLedgerStatus = "ok" | "missing" | "corrupt";

export interface WorkspaceLedgerLoad {
	entries: AgentTeamLedgerEntry[];
	status: WorkspaceLedgerStatus;
}

export function workspaceKey(cwd: string): string {
	return createHash("sha1").update(cwd).digest("hex").slice(0, 12);
}

export function workspaceLedgerPath(statePath: string): string {
	return path.join(path.dirname(statePath), WORKSPACE_LEDGER_FILE);
}

function trimEntries(entries: AgentTeamLedgerEntry[]): AgentTeamLedgerEntry[] {
	const out: AgentTeamLedgerEntry[] = [];
	for (const kind of ["fact", "excluded"] as const) {
		const max = kind === "fact" ? MAX_AGENT_TEAM_FACTS : MAX_AGENT_TEAM_EXCLUDED;
		out.push(...entries.filter((entry) => entry.kind === kind).slice(-max));
	}
	return out;
}

function decodeFile(raw: string): LedgerFile | null {
	try {
		const parsed = JSON.parse(raw) as Partial<LedgerFile>;
		if (!parsed || typeof parsed !== "object" || parsed.version !== VERSION) return null;
		if (!parsed.workspaces || typeof parsed.workspaces !== "object") return null;
		if (Array.isArray(parsed.workspaces)) return null;
		const workspaces: Record<string, WorkspaceRow> = {};
		for (const [key, item] of Object.entries(parsed.workspaces)) {
			if (!/^[a-f0-9]{12}$/.test(key)) continue;
			if (!item || typeof item !== "object" || Array.isArray(item)) continue;
			const row = item as unknown as Record<string, unknown>;
			const entries = trimEntries(decodeLedger(row.entries));
			if (entries.length === 0) continue;
			const updatedAt =
				typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : 0;
			workspaces[key] = { updatedAt, entries };
		}
		const kept = Object.entries(workspaces)
			.toSorted((a, b) => b[1].updatedAt - a[1].updatedAt)
			.slice(0, MAX_WORKSPACES);
		return { version: VERSION, workspaces: Object.fromEntries(kept) };
	} catch {
		return null;
	}
}

export function loadWorkspaceLedger(statePath: string, cwd: string): WorkspaceLedgerLoad {
	let raw: string;
	try {
		raw = fs.readFileSync(workspaceLedgerPath(statePath), "utf8");
	} catch {
		return { entries: [], status: "missing" };
	}
	const file = decodeFile(raw);
	if (!file) return { entries: [], status: "corrupt" };
	return { entries: file.workspaces[workspaceKey(cwd)]?.entries ?? [], status: "ok" };
}

export function saveWorkspaceLedger(
	statePath: string,
	cwd: string,
	entries: readonly AgentTeamLedgerEntry[],
	now = Date.now(),
): { error?: string } {
	const file = workspaceLedgerPath(statePath);
	const tmp = `${file}.${process.pid}.tmp`;
	try {
		let current: LedgerFile = { version: VERSION, workspaces: {} };
		try {
			current = decodeFile(fs.readFileSync(file, "utf8")) ?? current;
		} catch {
			/* a missing or unreadable ledger starts fresh */
		}
		const key = workspaceKey(cwd);
		const clean = trimEntries(decodeLedger(entries));
		const workspaces = { ...current.workspaces };
		if (clean.length > 0) workspaces[key] = { updatedAt: now, entries: clean };
		const kept = Object.entries(workspaces)
			.toSorted((a, b) => b[1].updatedAt - a[1].updatedAt)
			.slice(0, MAX_WORKSPACES);
		const json = JSON.stringify({ version: VERSION, workspaces: Object.fromEntries(kept) });
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(tmp, json, { encoding: "utf8", mode: 0o600 });
		fs.chmodSync(tmp, 0o600);
		fs.renameSync(tmp, file);
		return {};
	} catch (err) {
		try {
			fs.rmSync(tmp, { force: true });
		} catch {
			/* nothing left to clean */
		}
		return { error: err instanceof Error ? err.message : String(err) };
	}
}
