/**
 * pi-subagents: the plain-text help screen.
 */

export function helpText(): string {
	return [
		"Subagents — quick control",
		"",
		"  /subagents <prompt>        run the smallest matched roster",
		"  /subagents @a,@b <prompt>  run named subagents",
		"  /subagents team <prompt>   start an agent team",
		"  /subagents new             create a subagent",
		"",
		"More",
		"  /subagents list            browse subagent files",
		"  /subagents tasks           this session's runs",
		"  /subagents trash           restore a deleted file",
		"  /subagents help            this screen",
		"",
		"Board keys",
		"  ↑↓ move · enter open · n run · f finish · ? help",
		"  s steer · x stop · r retry · c copy · e show hidden",
		"  tab switch · 1 runs · 2 team · esc close",
		"",
		"Team keys",
		"  enter detail · o open run · e edit · a assign",
		"  c claim · r release · x done · d delete",
		"  v verify · i advice · n new task · s start team · t on/off",
		"",
		"Advanced: rounds, cross-verify, brief, worktrees, and promote",
		"live in the Team tab and in docs/usage.md.",
		"",
		"Aliases: finish = run · agent-team(s) = team · /delegate = one prompt on two legs.",
		"A name opens that subagent. Any other text starts a quick run.",
	].join("\n");
}
