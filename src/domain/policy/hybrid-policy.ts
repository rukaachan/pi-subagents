/**
 * pi-subagents: the default delegation ladder.
 */

export const HYBRID_POLICY = [
	"Hybrid delegation: pick the smallest level that fits, not the biggest.",
	"Local: one file, a decision, or an answer that decides your next step.",
	"Basic: one focused job -> one Task.",
	"Delegate: two independent roles -> one Task with parallel; /delegate is the user shortcut.",
	'AgentTeam: three or more pieces, shared state, blockers, or broad fan-out -> AgentTeam { action: "start", prompt, roster? }; it creates one task and one worker per leg.',
	"Never create a board for one job. Use explicit tasks with write scopes when files overlap; task changes never start agents, but AgentTeam start does. End your turn while waiting.",
].join("\n");
