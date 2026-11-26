/**
 * pi-subagents: print measured roster numbers from the local journal.
 */

import { foldJournalFile } from "../src/telemetry/journal/index.ts";
import { summarizeRoster } from "../src/domain/run/index.ts";

const json = process.argv.includes("--json");
const path = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const runs = foldJournalFile(path);
const report = summarizeRoster(runs);
if (json) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(`runs: ${report.runs} · groups: ${report.groups}`);
	for (const bucket of report.context) {
		console.log(
			`${bucket.label} turns · ${bucket.avgInputTokens} input tokens · ${bucket.runs} runs`,
		);
	}
	if (report.handoffTax !== undefined) {
		console.log(`handoff tax: ${report.handoffTax.toFixed(2)} (next prompt / prior report)`);
	}
	for (const row of report.bySize) {
		console.log(`size ${row.size}: ${Math.round(row.successRate * 100)}% · ${row.groups} groups`);
	}
	console.log(`recommendation: ${report.recommendation ?? "not enough data"}`);
}
