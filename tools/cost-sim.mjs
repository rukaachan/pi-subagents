/**
 * pi-subagents: cost simulation for the logged runs.
 */
const RATE_IN = 3 / 1_000_000; // $ per token
const RATE_OUT = 15 / 1_000_000;

const OLD_DISK = [
	{ id: "yhee-8", turns: 34, in: 1_565_152, out: 56_922 },
	{ id: "9gbx-9", turns: 26, in: 1_217_127, out: 32_524 },
	{ id: "jy5-10", turns: 16, in: 556_101, out: 38_470 },
	{ id: "myk-11", turns: 36, in: 1_746_762, out: 60_087 },
	{ id: "fa1-12", turns: 24, in: 1_009_528, out: 55_701 },
	{ id: "w9d-13", turns: 20, in: 824_681, out: 37_296 },
	{ id: "we5-14", turns: 25, in: 942_639, out: 54_891 },
	{ id: "2ya-15", turns: 37, in: 1_671_849, out: 73_125 },
];

const bill = (r) => r.in * RATE_IN + r.out * RATE_OUT;

function summarize(label, runs) {
	const total = runs.reduce((s, r) => s + bill(r), 0);
	const turns = runs.reduce((s, r) => s + r.turns, 0);
	console.log(
		`${label}: ${runs.length} runs | ${turns} turns | total $${total.toFixed(2)} | avg $${(total / runs.length).toFixed(2)}/run`,
	);
}

console.log("═══ what the pre-upgrade ledger would have cost on a $3/$15 API");
summarize("OLD disk-8 (unbounded caps, 8-tool decls)", OLD_DISK);

console.log("\n═══ worst single run, counterfactual with v0.13.x caps");
const spiral = { id: "worker spiral", turns: 124, in: 10_748_856, out: 265_745 };
console.log(`as it ran          : $${bill(spiral).toFixed(2)} (124 turns, 10.75M input)`);
const capped = {
	turns: 20,
	in: Math.round(10_748_856 * (20 / 124) * 0.8),
	out: Math.round(265_745 * (20 / 124)),
};
console.log(`with budget 20 caps: ~$${bill(capped).toFixed(2)} (20 turns, capped lean requests)`);

console.log("\n═══ the last session, simulated at real rates");
console.log(`worker spiral (as it ran): $${bill(spiral).toFixed(2)}`);
summarize("explorer leg A (8 turns)", [{ turns: 8, in: 64_478, out: 2_868 }]);
summarize("explorer leg B (9 turns)", [{ turns: 9, in: 76_379, out: 3_393 }]);
const ab = [
	{ turns: 7, in: 23_341, out: 800 },
	{ turns: 7, in: 18_279, out: 800 },
];
console.log(
	`A/B probe pair: old-shape $${bill(ab[0]).toFixed(4)} vs lean $${bill(ab[1]).toFixed(4)} (−${Math.round((1 - bill(ab[1]) / bill(ab[0])) * 100)}%)`,
);
