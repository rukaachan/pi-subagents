/**
 * pi-subagents: the host's usage shape.
 */

export function toUsage(details: {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}) {
	return {
		input: details.input,
		output: details.output,
		cacheRead: details.cacheRead,
		cacheWrite: details.cacheWrite,
		totalTokens: details.input + details.output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: details.cost },
	};
}
