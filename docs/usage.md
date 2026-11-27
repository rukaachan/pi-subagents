# Usage

This guide starts with the one-prompt path and adds detail only when you
need it. The short command list is in the README.

## Start here

```text
/subagents <prompt>        run the smallest matched roster
/subagents team <prompt>   start a shared team
/subagents new             create a subagent
/subagents                 open the board
```

If the text is exactly a real subagent name, `/subagents <name>` opens
that subagent instead. Any other text is a prompt. `/subagents run <prompt>`
skips that lookup and always runs.

## Run one prompt

```text
/subagents explain the auth flow and point at the risky lines
```

The "finish" path picks the smallest roster that fits, with at most four
legs. It matches the words in your prompt against each subagent's name and
`description`. It never starts more legs than `liveCap` allows.

Name the legs yourself when the match is not what you want:

```text
/subagents @explorer,@tester Find the failing path and prove the cause
```

The same work can be requested by the model with the `Task` tool:

```json
{
	"subagent_type": "explorer",
	"description": "Map the auth flow",
	"prompt": "Find the login path and report each step with file:line."
}
```

`Task` has per-run switches. They do not edit the subagent file:

| Field               | Effect                                              |
| ------------------- | --------------------------------------------------- |
| `subagent_type`     | Which subagent to run. Omit to auto-pick.           |
| `description`       | Short label in the menu and on cards.               |
| `prompt`            | The task. Required.                                 |
| `model`             | Replace the file model for this run.                |
| `codemode`          | `off`, `on`, or `only` for this run.                |
| `complexity`        | Thinking tier: `light`, `medium`, or `heavy`.       |
| `budget`            | Time, turns, tokens, cost, report cap.              |
| `run_in_background` | Return a task id now and wake the parent when done. |
| `resume`            | Continue a done task id in a fresh turn.            |
| `parallel`          | Run several subagents at once.                      |
| `chain`             | Run steps in order, fresh context per step.         |
| `temp_definition`   | Use a one-session subagent, not a file.             |
| `return`            | Add a contract tail such as files or risks.         |

Legs past the live cap wait in a queue. They are not dropped.

## Run a team

A team shares one task board. Each start creates one board task per
leg, each with its own worker:

```text
/subagents team split the parser rewrite into independent files
```

Turn the board on for other task legs:

```text
/subagents team on
/subagents team off
```

The Team tab shows the board in the editor area. Press `t` to toggle
team mode. Each task is a card; the footer shows only
the keys that work on the selected task, and `/subagents help` lists
every key.

Common Team keys:

```text
enter open run  n new task      s start team
e edit          a assign        c claim
r release       x complete      d delete
o open run      v verify        i advice
tab             esc
```

A task has a subject, description, write scopes, and optional blockers.
A completed task keeps its result (up to 2,000 characters). Write scopes
warn when two tasks reserve the same path. A task never starts a worker
on its own; the lead starts the team.

The model uses the `AgentTeam` tool for the same board:

```json
{ "action": "start", "prompt": "Split the parser rewrite by file." }
```

The full action list is `start`, `round`, `status`, `list`, `get`,
`resolve`, `create`, `claim`, `release`, `edit`, `complete`,
`reopen`, `reassign`, `delete`, `verify`, `advise`, `brief`,
`worktree`, and `promote`.

## Create a subagent

```text
/subagents new
```

The short path asks four things: location, name, description, and prompt.
It writes a valid read-only starter with the inherited model and low
autonomy. The full path exposes model, tools, thinking level, autonomy,
codemode, and timeout.

```text
/subagents <name>       open it
/subagents list         browse files
/subagents trash        restore a deleted file
```

Pick **Edit** to change one field in place. Delete moves the file to
`~/.pi/agent/subagents/.trash`; it is not a permanent delete.

A file looks like this:

```markdown
---
name: reviewer
description: Reviews a diff for bugs and missing tests.
model: inherit
tools: read-only
autonomy: low
---

You review code. Report findings by severity with `file:line`, then name
the test that would catch each one. Do not edit files.
```

### File fields

| Field           | Values and effect                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `name`          | Required. Lowercase letters, digits, `-`, and `_`.                                              |
| `description`   | Menu text and the words used by the roster picker. Keep it short.                               |
| `model`         | `inherit` (default) or `provider/id`.                                                           |
| `thinkingLevel` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Ignored when the model is inherited. |
| `tools`         | `read-only`, `edit`, `execute`, or a comma list. Omit for every tool.                           |
| `paths`         | Workspace-relative write folders. Shell tools are off while the fence is set.                   |
| `autonomy`      | `inherit`, `off`, `low`, `medium`, `high`. Lower levels clamp tools.                            |
| `codemode`      | `off`, `on`, or `only`. Default is `only`.                                                      |
| `mcp`           | `true` opens configured MCP servers. Needs medium+ autonomy and codemode on/only.               |
| `gates`         | `true` blocks a fixed destructive-call list inside the child.                                   |
| `context`       | `true` loads `AGENTS.md` and project context into the child.                                    |
| `promptPrefix`  | Up to 400 characters, prepended to every task this subagent gets.                               |
| `budget`        | See [Budgets](budgets.md).                                                                      |

Settings can override model, tools, autonomy, codemode, and budgets. A
per-run switch still wins.

## Watch a run

Open the board with `/subagents` or `/subagents tasks`. It fills the
editor area; `esc` closes it.

```text
Runs keys:  ↑↓ move · enter open · n run · f finish
            s steer · x stop · r retry · c copy · e hidden
            tab switch · 1 runs · 2 team · esc close
```

The footer shows only the keys for the selected card. Run
`/subagents help` for the full list.

A live run streams its answer. A done run shows its saved history. The
viewer has three tabs: transcript, tools, and errors. `y` copies the
visible tab; `/` searches with a literal, case-insensitive phrase;
`n` and `N` step through matches; `e` jumps to the next error. The
newest 300 KB of a transcript is kept; older lines collapse into one
hidden row.

Steering puts a message into a live child before its next turn. Stopping
is immediate. Retrying starts a fresh attempt from the saved task.

## Read the result

Every run returns one report. A run that ends on a tool call is marked
`[incomplete]`; a run cut by a limit is marked `[cut short] <reason>`.
The marker is built from the real session, not from the model's memory.

A stopped or failed run keeps a short WHY section in its task detail:
the failure family, token and turn count, and the last tools. This is a
reading aid, not a new verdict.

```text
/subagents tasks
/delegate reports
/delegate report <name>
/delegate open <name>
```

## Advanced options

Use these only when the simple path is not enough.

| Feature            | How to use it                                                          | Notes                                                                                                  |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Rounds             | `AgentTeam { action: "round", prompt, budget_tokens, budget_minutes }` | Up to 5 rounds; 12 legs per round; default 500k tokens / 30 min; hard caps 5M / 6h.                    |
| Cross-verify       | Set `cross_verify: true` and `acceptance` on a task.                   | A second reader checks the first. It is a second opinion, not a correctness proof.                     |
| Brief              | `AgentTeam { action: "brief", question }`                              | One read-only advisor/planner pass; 120 s; up to 2,000 characters.                                     |
| Worktree isolation | `isolation: "worktree"` on start, round, create, or edit.              | One git worktree per leg. Only clean worktrees can be retired; dirty ones stay.                        |
| Promote            | `AgentTeam { action: "promote", task_id }`                             | Preview by default; `confirm: true` writes to the drafts folder. Existing files are never overwritten. |
| Workspace ledger   | Automatic                                                              | Local per-workspace facts and dead ends, stored beside task state. It is not shared or published.      |
| Finish hook        | `finishHook` in settings                                               | One shell command per finished run. User settings always; project settings only when trusted.          |
| MCP                | `mcp: true`                                                            | Servers come from `mcp.json`. Sign in with `/mcp` in the parent first.                                 |
| Gates              | `gates: true`                                                          | Blocks a fixed list of destructive calls. A child has no UI and never prompts.                         |
| Context            | `context: true`                                                        | Loads project rules into the child. It costs context; the run note shows the size.                     |
| Paths              | `paths: [src, docs]`                                                   | Write fence. Shell tools are off; MCP is refused.                                                      |
| Temp subagent      | `temp_definition` on `Task`                                            | Exists for one session.                                                                                |

## Global settings

Settings live in `~/.pi/agent/settings.json` or `.pi/settings.json`.
Project settings are read only when the project is trusted.

```json
{
	"pi-subagents": {
		"codemode": "off",
		"model": "provider/model",
		"tools": ["read", "grep"],
		"autonomy": "low",
		"budget": { "timeoutSec": 600, "maxReportChars": 4000 },
		"liveCap": 8,
		"roundBudgetTokens": 500000,
		"roundBudgetMinutes": 30,
		"alias": true,
		"settleNotify": true,
		"finishHook": "cat >> ~/pi-legs.ndjson"
	}
}
```

| Setting              | Default    | Effect                                                                              |
| -------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `codemode`           | `only`     | `off`, `on`, or `only`.                                                             |
| `model`              | inherit    | Replaces the file model.                                                            |
| `tools`              | file value | Replaces the file tool list.                                                        |
| `autonomy`           | inherit    | Replaces the file level.                                                            |
| `budget`             | file value | Merges key by key.                                                                  |
| `liveCap`            | 12         | Live legs, 1–64.                                                                    |
| `roundBudgetTokens`  | 500000     | Default per-round cap, up to 5M.                                                    |
| `roundBudgetMinutes` | 30         | Default per-round wall clock, up to 360.                                            |
| `alias`              | true       | Register the `subagent` compatibility tool. Read at load; `/reload` after changing. |
| `settleNotify`       | true       | Wake the parent when a background leg settles.                                      |
| `finishHook`         | none       | Shell command per finished run.                                                     |

## Limits

- Four legs for the auto-picked finish roster; 12 live by default.
- 12 legs per team round; 5 rounds per team.
- 900 s stall watchdog, 300 s wind-down, 10 s hard-stop grace.
- Report caps are per subagent or per run; the default starter cap is 6,000 characters.
- State is capped at 2 MB per file. History keeps the newest 60 messages
  and 24,000 characters.
- A path-based install breaks if the checkout moves.

## Troubleshooting

`No subagents found` means no Markdown files are in the user or project
subagent folder. Copy the starters or run `/subagents new`.

`No subagent matched` means the auto picker found no useful match. Name
one explicitly with `@name` or use a broader prompt.

`Unknown subagent` from an explicit named run means the name is not in
the roster. `/subagents list` shows the real names.

A run that ends `[cut short]` hit a limit. Read the reason in the report
or the why section; it names the exact cap. A run that ends
`[incomplete]` stopped on a tool call, not on a final answer.
