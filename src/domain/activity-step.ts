/**
 * pi-subagents: one step of a run.
 */

export const RECENT_LIMIT = 3;

export const DETAIL_CHARS = 48;

export interface ActivityStep {
	tool: string;
	detail?: string;
	nested?: boolean;
}

export function compactionNote(tokensBefore: number, tokensAfter?: number): string {
	const before = `${Math.round(tokensBefore)} tokens`;
	const after = tokensAfter === undefined ? "the summary" : `${Math.round(tokensAfter)} tokens`;
	return `context compacted: ${before} became ${after}. The early messages are now a summary.`;
}

export function nestedStep(
	outerTool: string,
	innerTool: string,
	innerDetail?: string,
): ActivityStep {
	const inner = innerDetail ? `${innerTool} ${innerDetail}` : innerTool;
	return { tool: outerTool, detail: inner, nested: true };
}
