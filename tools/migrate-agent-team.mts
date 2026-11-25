/**
 * pi-subagents: rewrite stored team names to agent-team names.
 *
 * Run: node --experimental-strip-types tools/migrate-agent-team.mts [--write|--verify]
 * Default is a dry run. Backups end in .pre-agent-team.bak and stay on disk.
 */
import {
	copyFileSync,
	existsSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultJournalPath } from "../src/telemetry/journal/journal-path.ts";

export interface MigrationTarget {
	path: string;
	kind: "state" | "journal";
}

export interface MigrationReport {
	scanned: number;
	changed: string[];
	skipped: { path: string; reason: string }[];
}

type TextResult = { ok: true; text: string; changed: boolean } | { ok: false; reason: string };

const OLD_EVENT = /"event"(\s*:\s*)"team_(task|message)"/g;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function migrateColdMail(value: unknown): unknown {
	if (!isRecord(value)) return value;
	const out: Record<string, unknown> = {};
	for (const [name, list] of Object.entries(value)) {
		out[name] = Array.isArray(list)
			? list.map((item) =>
					typeof item === "string" && item.startsWith("[team message]")
						? `[agent-team message]${item.slice("[team message]".length)}`
						: item,
				)
			: list;
	}
	return out;
}

function migrateTeamRow(value: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (key === "teamId") out.agentTeamId = item;
		else if (key === "coldMail") out.coldMail = migrateColdMail(item);
		else out[key] = item;
	}
	return out;
}

export function migrateStateText(raw: string): TextResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, reason: "invalid JSON" };
	}
	if (!isRecord(parsed) || !isRecord(parsed.team)) return { ok: true, text: raw, changed: false };
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(parsed)) {
		out[key === "team" ? "agentTeam" : key] =
			key === "team" ? migrateTeamRow(value as Record<string, unknown>) : value;
	}
	const text = JSON.stringify(out) + (raw.endsWith("\n") ? "\n" : "");
	return { ok: true, text, changed: text !== raw };
}

export function migrateJournalText(raw: string): TextResult {
	const lines = raw.split("\n");
	let changed = false;
	for (const [index, line] of lines.entries()) {
		if (!line.trim()) continue;
		try {
			JSON.parse(line);
		} catch {
			return { ok: false, reason: `invalid JSON at line ${index + 1}` };
		}
		const next = line.replace(OLD_EVENT, '"event"$1"agent_team_$2"');
		if (next !== line) {
			lines[index] = next;
			changed = true;
		}
	}
	return { ok: true, text: lines.join("\n"), changed };
}

export function verifyTarget(target: MigrationTarget): number {
	let raw: string;
	try {
		raw = readFileSync(target.path, "utf8");
	} catch {
		return 0;
	}
	if (target.kind === "journal") return [...raw.matchAll(OLD_EVENT)].length;
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (!isRecord(parsed)) return 0;
		let count = Object.hasOwn(parsed, "team") ? 1 : 0;
		if (isRecord(parsed.team) && Object.hasOwn(parsed.team, "teamId")) count += 1;
		return count;
	} catch {
		return 0;
	}
}

function backup(path: string): void {
	try {
		copyFileSync(path, `${path}.pre-agent-team.bak`, constants.COPYFILE_EXCL);
	} catch {
		/* keep the first backup */
	}
}

export function writeIfUnchanged(
	path: string,
	text: string,
	before: { mtimeMs: number; size: number },
): boolean {
	const after = statSync(path);
	if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) return false;
	const tmp = `${path}.tmp-${process.pid}`;
	writeFileSync(tmp, text, "utf8");
	const latest = statSync(path);
	if (latest.mtimeMs !== before.mtimeMs || latest.size !== before.size) {
		unlinkSync(tmp);
		return false;
	}
	renameSync(tmp, path);
	return true;
}

export function migrateFiles(
	targets: MigrationTarget[],
	options: { write: boolean },
): MigrationReport {
	const report: MigrationReport = { scanned: 0, changed: [], skipped: [] };
	for (const target of targets) {
		if (!existsSync(target.path)) continue;
		const before = statSync(target.path);
		let raw: string;
		try {
			raw = readFileSync(target.path, "utf8");
		} catch (error) {
			report.skipped.push({ path: target.path, reason: String(error) });
			continue;
		}
		const result = target.kind === "state" ? migrateStateText(raw) : migrateJournalText(raw);
		if (!result.ok) {
			report.skipped.push({ path: target.path, reason: result.reason });
			continue;
		}
		report.scanned += 1;
		if (!result.changed) continue;
		report.changed.push(target.path);
		if (!options.write) continue;
		backup(target.path);
		if (!writeIfUnchanged(target.path, result.text, before))
			report.skipped.push({ path: target.path, reason: "file changed during migration" });
	}
	return report;
}

export function defaultTargets(): MigrationTarget[] {
	const stateDir = join(homedir(), ".pi", "agent", "pi-subagents-state");
	const journal = defaultJournalPath();
	const targets: MigrationTarget[] = [];
	if (existsSync(stateDir)) {
		for (const name of readdirSync(stateDir)
			.filter((entry) => entry.endsWith(".json"))
			.toSorted())
			targets.push({ path: join(stateDir, name), kind: "state" });
	}
	for (const path of [journal, `${journal}.1`])
		if (existsSync(path)) targets.push({ path, kind: "journal" });
	return targets;
}

function main(): void {
	const args = new Set(process.argv.slice(2));
	const write = args.has("--write");
	const verify = args.has("--verify");
	if (write && verify) {
		console.error("use --write or --verify, not both");
		process.exit(2);
	}
	const targets = defaultTargets();
	if (verify) {
		const rows = targets
			.map((target) => ({ path: target.path, count: verifyTarget(target) }))
			.filter((row) => row.count > 0);
		for (const row of rows) console.log(`${row.count} old name(s) in ${row.path}`);
		console.log(
			rows.length === 0 ? "verify: 0 old names" : `verify: ${rows.length} file(s) still old`,
		);
		process.exit(rows.length === 0 ? 0 : 1);
	}
	const report = migrateFiles(targets, { write });
	console.log(
		`${write ? "write" : "dry-run"}: ${report.scanned} scanned, ${report.changed.length} changed, ${report.skipped.length} skipped`,
	);
	for (const path of report.changed) console.log(`changed: ${path}`);
	for (const row of report.skipped) console.log(`skipped: ${row.path}: ${row.reason}`);
}

if (process.argv[1]?.endsWith("migrate-agent-team.mts")) main();
