/**
 * pi-subagents: the smallest roster that fits the prompt.
 */

import { DISPATCH_RULES } from "../policy/index.ts";
import type { SubagentConfig } from "./config.ts";

export interface RosterPick {
	name: string;
	score: number;
	rule?: string;
	matched?: string;
	why: string;
}

type RosterSub = Pick<SubagentConfig, "name" | "description">;

// One shared word is noise; a rule, a name, or three words is signal.
const MIN_SCORE = 3;

const STOP = new Set([
	"the",
	"and",
	"for",
	"with",
	"that",
	"this",
	"from",
	"into",
	"your",
	"you",
	"use",
	"all",
	"any",
	"can",
	"not",
	"but",
	"are",
	"was",
	"were",
	"will",
	"has",
	"have",
	"its",
	"our",
	"their",
	"them",
	"then",
	"than",
	"when",
	"what",
	"which",
	"how",
	"why",
	"who",
	"where",
	"also",
	"just",
	"need",
	"want",
	"get",
	"set",
]);

function words(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length >= 3 && !STOP.has(word));
}

function hit(text: string, keyword: string): boolean {
	const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
	return pattern.test(text);
}

export function scoreRoster(prompt: string, subs: readonly RosterSub[]): RosterPick[] {
	const lower = prompt.toLowerCase();
	const promptWords = new Set(words(lower));
	const picks: RosterPick[] = [];
	for (const sub of subs) {
		let score = 0;
		const why: string[] = [];
		let rule: string | undefined;
		let matched: string | undefined;
		for (const entry of DISPATCH_RULES) {
			if (entry.subagent !== sub.name) continue;
			const keyword = entry.keywords.find((k) => hit(lower, k));
			if (!keyword) continue;
			score += entry.tier === "fallback" ? 3 : 5;
			rule = entry.rule;
			matched = keyword;
			why.push(`${entry.rule}: "${keyword}"`);
			break;
		}
		if (hit(lower, sub.name)) {
			score += 4;
			why.push(`named "${sub.name}"`);
		}
		const own = new Set(words(`${sub.name} ${sub.description}`));
		let shared = 0;
		for (const word of promptWords) if (own.has(word)) shared += 1;
		if (shared > 0) {
			score += Math.min(3, shared);
			why.push(`${shared} shared word${shared === 1 ? "" : "s"}`);
		}
		if (score < MIN_SCORE) continue;
		picks.push({
			name: sub.name,
			score,
			...(rule ? { rule } : {}),
			...(matched ? { matched } : {}),
			why: why.join(" · "),
		});
	}
	return picks.toSorted((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** Top picks, at least one, never more than `max`. */
export function pickRoster(prompt: string, subs: readonly RosterSub[], max = 4): RosterPick[] {
	const limit = Math.max(1, max);
	const ranked = scoreRoster(prompt, subs).slice(0, limit);
	if (ranked.length > 0) return ranked;
	const fallback = subs.find((sub) => sub.name === "worker") ?? subs[0];
	return fallback ? [{ name: fallback.name, score: 0, why: "fallback: no rule matched" }] : [];
}
