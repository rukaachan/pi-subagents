/**
 * pi-subagents: what the model is told about Task.
 */

export const DELEGATION_RULE =
	"Delegate at the smallest level that fits: one focused job is one Task; two independent roles use parallel; 3+ files, 2+ modules, about 8 tool calls, or a command over 2 minutes use the ladder; keep a one-file change or a decision local. Three or more pieces with shared state or broad fan-out use AgentTeam start with a prompt. End your turn while waiting.";

export const taskMeta = {
	name: "Task",
	label: "Task",
	description: [
		"Delegate one task to one subagent in a fresh context window.",
		"Foreground: returns the subagent result. Background (run_in_background: true): returns a task_id now; when the leg finishes it wakes you with its report, so end your turn instead of polling (TaskOutput reads it again).",
		"Nameless: omit subagent_type and the pack picks one from the prompt text (review→code-reviewer, test→tester, research→researcher, plan→planner, find/map→explorer, fix/implement→worker); the pick and its rule are echoed in the result.",
		"Chain: pass chain: [explorer, worker, reviewer] to run subagents in order; each step gets the prior step report.",
		"Parallel: pass parallel: [explorer, tester] or [{subagent_type, prompt}] to run subagents at the same time; each leg gets its own task_id, poll each with TaskOutput. Fan-out from ONE task with many independent targets (files, modules, paths) is yours to decide: read the task once, and when the legs are independent compose one parallel call with per-leg prompts instead of sequential Tasks — up to the live cap (12); more legs is refused up front, so batch. Tailor each leg's prompt to that subagent's role: the same text for every leg wastes the pack's specialization.",
		"Resume: pass resume: task_id plus a new prompt to continue a done task with its history.",
		"Return: pass return: [files, risks] to make a single report end with those lines; the result flags any missing.",
		"Failure label: after a failed task, record why with TaskOutput(task_id, failure: spec|coordination|verification); it is never inferred.",
		"Complexity: light, medium, or heavy sets the thinking tier. Model: override the model for this run only.",
		"Summarize results for the user; do not paste raw output.",
		"Temp: pass temp_definition {name, description, systemPrompt (≤20 lines, ≤120 chars/line), model?, tools?, paths?, codemode?, budget?} to register a session-scoped custom subagent and run this task with it; reuse the name in later Task calls, chains, or fan-out legs. Nothing is written to disk — the temp dies with the session; names never shadow persistent starters, autonomy stays system-controlled.",
	].join(" "),
	promptSnippet:
		"Task(subagent_type, description, prompt): run one subagent in a fresh window. chain[] = sequential, parallel[] = fan-out.",
	promptGuidelines: [DELEGATION_RULE],
};
