/**
 * pi-subagents: the /delegate, finish, and team start argument grammar.
 */

export type LaunchKind = "delegate" | "finish" | "agent-team";

/** `/delegate` without a roster runs these two. */
export const DELEGATE_LEGS = ["explorer", "worker"] as const;

export interface LaunchRequest {
	/** Explicit legs, or null for the command's default roster. */
	roster: string[] | null;
	prompt: string;
}

export type LaunchParse = { ok: true; request: LaunchRequest } | { ok: false; error: string };

export type ReportMode = "compact" | "status" | "full";

export interface ReportQuery {
	mode: ReportMode;
	target?: string;
}

/** `reports`, `status`, or `report <name|task-id>`. */
export function parseReportQuery(text: string): ReportQuery | null {
	const raw = text.trim();
	if (!raw) return null;
	const space = raw.search(/\s/);
	const head = (space < 0 ? raw : raw.slice(0, space)).toLowerCase();
	if (head === "status") return { mode: "status" };
	if (head !== "report" && head !== "reports") return null;
	const target = (space < 0 ? "" : raw.slice(space).trim()).replace(/^@/, "").trim();
	return target ? { mode: "full", target } : { mode: "compact" };
}

export function defaultLegs(kind: LaunchKind, available: string[]): string[] {
	if (kind === "delegate") return [...DELEGATE_LEGS];
	if (kind === "finish") return available.slice(0, 4);
	return [...available];
}

export function rosterFor(
	kind: LaunchKind,
	roster: string[] | null,
	available: string[],
): string[] {
	return [...new Set(roster ?? defaultLegs(kind, available))];
}

export function unknownLegs(names: string[], available: string[]): string[] {
	return names.filter((name) => !available.includes(name));
}

export function parseLaunchArgs(args: string): LaunchParse {
	let rest = args.trim();
	if (!rest) return { ok: false, error: "Type a prompt after the command." };
	const names: string[] = [];
	let sawRoster = false;
	while (rest.startsWith("@")) {
		sawRoster = true;
		const space = rest.search(/\s/);
		const head = space < 0 ? rest : rest.slice(0, space);
		rest = space < 0 ? "" : rest.slice(space).trim();
		for (const raw of head.split(",")) {
			const name = raw.replace(/^@/, "").trim();
			if (name) names.push(name);
		}
	}
	const roster = [...new Set(names)];
	if (sawRoster && roster.length === 0) {
		return { ok: false, error: "Empty roster. Name legs like @explorer,@tester." };
	}
	if (!rest) {
		return {
			ok: false,
			error: "Needs a prompt after the roster. Example: @explorer,@tester map auth.",
		};
	}
	return { ok: true, request: { roster: roster.length > 0 ? roster : null, prompt: rest } };
}

/** `open <name|task-id>`, or null when the first word is not `open`. */
export function parseOpenQuery(text: string): string | null {
	const raw = text.trim();
	const space = raw.search(/\s/);
	const head = (space < 0 ? raw : raw.slice(0, space)).toLowerCase();
	if (head !== "open") return null;
	return (space < 0 ? "" : raw.slice(space).trim()).replace(/^@/, "").trim();
}

export interface LegRef {
	name: string;
	taskId?: string;
	status: string;
}

export type LegLookup =
	| { ok: true; leg: LegRef }
	| { ok: false; error: string; matches?: LegRef[] };

function loose(id: string): string {
	return id.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Resolve a leg by name, full id, id suffix, or unique id prefix. */
export function findLaunchLeg(legs: readonly LegRef[], target: string): LegLookup {
	const wanted = target.trim().toLowerCase();
	if (!wanted) return { ok: false, error: "Name a leg. Example: /delegate open worker" };
	const suffix = loose(wanted);
	const names = legs.map((leg) => leg.name).join(", ");
	if (!suffix) return { ok: false, error: `No leg named "${target}". Legs: ${names}` };
	const pick = (list: LegRef[]): LegLookup | null => {
		const one = list[0];
		if (list.length === 1 && one) return { ok: true, leg: one };
		if (list.length > 1) {
			return { ok: false, error: `"${target}" matches ${list.length} legs.`, matches: list };
		}
		return null;
	};
	return (
		pick(legs.filter((leg) => leg.name.toLowerCase() === wanted)) ??
		pick(legs.filter((leg) => leg.taskId?.toLowerCase() === wanted)) ??
		pick(legs.filter((leg) => leg.taskId && loose(leg.taskId).endsWith(suffix))) ??
		pick(legs.filter((leg) => leg.taskId && loose(leg.taskId).startsWith(suffix))) ?? {
			ok: false,
			error: `No leg named "${target}". Legs: ${names}`,
		}
	);
}
