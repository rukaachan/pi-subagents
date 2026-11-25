/**
 * pi-subagents: the fields a caller needs back.
 */

import type { FailureFamily } from "../policy/index.ts";

export const MAX_RETURN_FIELDS = 8;
export const MAX_RETURN_FIELD_CHARS = 40;

export interface ReturnContract {
	fields: string[];
}

export function parseReturn(value: unknown): ReturnContract | { error: string } {
	if (value === undefined) return { fields: [] };
	if (!Array.isArray(value)) return { error: "return must be a list of field names." };
	const fields: string[] = [];
	const seen = new Set<string>();
	for (const raw of value) {
		if (typeof raw !== "string") {
			return { error: `return must contain only strings (got ${typeof raw}).` };
		}
		const field = raw.replace(/\s+/g, " ").trim();
		if (!field) return { error: "return has an empty field name." };
		if (field.length > MAX_RETURN_FIELD_CHARS) {
			return {
				error: `return field "${field.slice(0, 20)}…" is over ${MAX_RETURN_FIELD_CHARS} chars.`,
			};
		}
		const key = field.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		fields.push(field);
	}
	if (fields.length === 0) return { error: "return needs at least one field." };
	if (fields.length > MAX_RETURN_FIELDS) {
		return { error: `return takes at most ${MAX_RETURN_FIELDS} fields (got ${fields.length}).` };
	}
	return { fields };
}

/** Appended after the task; empty when the caller named no fields. */
export function contractPrompt(fields: readonly string[]): string {
	if (fields.length === 0) return "";
	return [
		"",
		"",
		"End the report with one line per field, in this shape:",
		"<field>: <value>",
		`Required fields: ${fields.join(", ")}`,
	].join("\n");
}

/** A presence check, not a quality check. Only the final block of lines counts. */
export function missingReturn(text: string, fields: readonly string[]): string[] {
	const block = finalBlock(text);
	return fields.filter((field) => !(block.get(normalizeField(field)) ?? ""));
}

export function checkReturn(
	text: string,
	fields: readonly string[],
): { text: string; missing: string[]; failure?: FailureFamily } {
	const missing = missingReturn(text, fields);
	if (missing.length === 0) return { text, missing };
	return {
		text: `${text}\n\n[return] missing: ${missing.join(", ")}`,
		missing,
		failure: "verification",
	};
}

const FIELD_LINE = /^([^:\n]{1,80}):[ \t]*(.*)$/;

function normalizeField(field: string): string {
	return field.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The last contiguous run of `Field: value` lines, read bottom-up. */
export function finalBlock(text: string): Map<string, string> {
	const lines = text.split("\n");
	const found = new Map<string, string>();
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = (lines[i] ?? "").trim();
		if (!line) {
			if (found.size > 0) break;
			continue;
		}
		const match = FIELD_LINE.exec(line);
		if (!match) break;
		const key = normalizeField(match[1] ?? "");
		if (!key) break;
		if (!found.has(key)) found.set(key, (match[2] ?? "").trim());
	}
	return found;
}
