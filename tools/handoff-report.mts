/**
 * pi-subagents: per-subagent handoff economics from the run journal.
 *
 * Run: npm run report:handoff
 */
import { handoffRows } from "../src/telemetry/journal/handoff.ts";
import { defaultJournalPath } from "../src/telemetry/journal/journal-path.ts";
import { foldJournalFile } from "../src/telemetry/journal/journal-fold.ts";

const path = defaultJournalPath();
const runs = new Map<string, ReturnType<typeof foldJournalFile>[number]>();
for (const run of [...foldJournalFile(path), ...foldJournalFile(`${path}.1`)])
	runs.set(run.id, run);
const rows = handoffRows([...runs.values()]);
if (rows.length === 0) {
	console.log("no runs in the journal");
	process.exit(0);
}
const header = [
	"subagent",
	"runs",
	"done",
	"error",
	"stop",
	"p50 turns",
	"p50 in",
	"p50 chars",
	"chars/1k",
	"no usage",
];
const cells = rows.map((row) => [
	row.subagent,
	String(row.runs),
	String(row.done),
	String(row.error),
	String(row.stopped),
	String(row.p50Turns ?? "n/a"),
	String(row.p50InputTokens ?? "n/a"),
	String(row.p50ReportChars ?? "n/a"),
	String(row.charsPer1k ?? "n/a"),
	String(row.noUsage),
]);
const widths = header.map((name, i) =>
	Math.max(name.length, ...cells.map((cell) => cell[i]?.length ?? 0)),
);
const line = (cell: string[]): string =>
	cell.map((value, i) => value.padEnd(widths[i] ?? 0)).join("  ");
console.log(line(header));
for (const cell of cells) console.log(line(cell));
const noUsage = rows.reduce((sum, row) => sum + row.noUsage, 0);
if (noUsage > 0) {
	console.log(
		"\n" + noUsage + " run(s) have no usage data (old journal or provider reported nothing).",
	);
}
