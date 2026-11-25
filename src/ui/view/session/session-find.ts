/**
 * pi-subagents: literal transcript search.
 */

export interface FindView {
	label: string;
	editing: boolean;
	query: string;
}

/** Line indexes whose text contains the query, ignoring case. Regex is not used. */
export function findMatches(lines: readonly string[], query: string): number[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [];
	const hits: number[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line !== undefined && line.toLowerCase().includes(needle)) hits.push(index);
	}
	return hits;
}

export interface FindState {
	readonly editing: boolean;
	readonly query: string;
	begin(): void;
	type(text: string): void;
	backspace(): void;
	/** Keep the query and jump to the first hit; returns the line to scroll to. */
	commit(lines: readonly string[]): number | undefined;
	cancel(): void;
	/** Step n/N; returns the line to scroll to, or undefined when nothing matches. */
	step(delta: number, lines: readonly string[]): number | undefined;
	view(): FindView;
}

export function createFind(): FindState {
	let query = "";
	let editing = false;
	let hits: number[] = [];
	let at = -1;

	function recompute(lines: readonly string[]): void {
		const previous = at >= 0 ? hits[at] : undefined;
		hits = findMatches(lines, query);
		if (hits.length === 0) {
			at = -1;
			return;
		}
		const kept = previous === undefined ? -1 : hits.indexOf(previous);
		at = kept >= 0 ? kept : Math.min(Math.max(at, 0), hits.length - 1);
	}

	function lineAt(): number | undefined {
		return at >= 0 ? hits[at] : undefined;
	}

	return {
		get editing() {
			return editing;
		},
		get query() {
			return query;
		},
		begin() {
			query = "";
			editing = true;
			hits = [];
			at = -1;
		},
		type(text) {
			if (!editing) return;
			query += text;
		},
		backspace() {
			if (editing) query = query.slice(0, -1);
		},
		commit(lines) {
			editing = false;
			at = -1;
			recompute(lines);
			return lineAt();
		},
		cancel() {
			editing = false;
			query = "";
			hits = [];
			at = -1;
		},
		step(delta, lines) {
			if (editing || !query.trim()) return undefined;
			recompute(lines);
			if (hits.length === 0) return undefined;
			at = (at + delta + hits.length) % hits.length;
			return lineAt();
		},
		view() {
			if (editing) return { label: `find: ${query}▌`, editing, query };
			if (!query.trim()) return { label: "", editing, query };
			if (hits.length === 0) return { label: "no match", editing, query };
			return { label: `${at + 1}/${hits.length}`, editing, query };
		},
	};
}
