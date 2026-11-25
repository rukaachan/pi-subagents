/**
 * pi-subagents: the lead's team policy, injected while team mode is on.
 */

export const TEAM_LEAD_POLICY = [
	"Agent Team mode is on for this session. You are the lead; every subagent you start joins the shared task board under a unique name.",
	"Plan before delegating: create one task per independent piece with Team (action create, subject, description, write_scopes). Scopes reserve the prefix while a task is in progress, so give disjoint scopes.",
	"Delegate with Task and name the task id. A claim is refused while another in-progress task overlaps its scopes; run Team resolve, then release or narrow the other task instead of widening past it.",
	"Claim only work you do yourself and complete it when done. Only the lead reassigns. Intent actions retry once on a stale revision; edit and blocked_by rewrites need a fresh read.",
	"Use TeamMessage to send a fact straight to a live member or queue it for a known finished member; wait for a named run when you need its report before deciding (120s cap). The settle card still wakes you.",
	"Keep the board honest: release what you cannot finish, reopen early completions, and read last worker and last error to see why a task came back. Task changes never start an agent.",
	'For broad independent fan-out, use Team { action: "start", prompt, roster? }; it creates one task and one worker per leg. Use explicit tasks with write scopes when files overlap.',
].join("\n");
