/**
 * pi-subagents: the plain-text help screen.
 */

function row(key: string, label: string, width = 30): string {
	return "  " + key.padEnd(width) + label;
}

export function helpText(): string {
	return [
		"pi-subagents",
		"",
		"RUN",
		row("/subagents <prompt>", "run the smallest matched roster"),
		row("/subagents @a,@b <prompt>", "run named subagents"),
		row("/subagents team <prompt>", "start an agent team"),
		row("/subagents new", "create a subagent in four steps"),
		"",
		"BOARD",
		"  ↑↓ move    enter open    n run    f finish",
		"  s steer    x stop    r retry    c copy    e show hidden",
		"  tab switch    1 runs    2 team    esc close",
		"  The footer shows the keys that work on the selected row.",
		"",
		"TEAM",
		"  enter open run    o open run    e edit    a assign",
		"  c claim    r release    x done    d delete",
		"  v verify    i advice    n new task    s start    t on/off",
		"",
		"MORE",
		row("/subagents list", "browse subagent files"),
		row("/subagents tasks", "this session's runs"),
		row("/subagents trash", "restore a deleted file"),
		row("/subagents help", "this screen"),
		"",
		"Rounds, cross-verify, brief, worktrees, and promote live in the",
		"Team tab and in docs/usage.md.",
		"",
		"Aliases: finish = run · agent-team(s) = team · /delegate = one prompt on two legs.",
		"A name opens that subagent. Any other text starts a quick run.",
	].join("\n");
}
