# pi-subagents

Run small, focused AI workers in a fresh context.

A subagent is a Markdown file. The frontmatter sets its model, tools, and
limits; the body is its standing prompt. Pi can run one subagent with a
task, or run several as a parallel group or a shared team.

This package is a local Pi extension. It is not published to npm.

## Requirements

- Pi 1.4.0 or newer.
- Node.js 22.19 or newer.

## Install

Clone the repository somewhere permanent and install it by path:

```bash
pi install /path/to/pi-subagents
```

Restart Pi or run `/reload`. Check the package is visible:

```bash
pi list
```

The path is stored in `~/.pi/agent/settings.json`. Moving the checkout
breaks the install; run `pi install` again with the new path. Files are
read in place, so a `git pull` only needs `/reload`.

For one project, trust the project and install locally:

```bash
pi install --local /path/to/pi-subagents
```

Remove it with `pi remove /path/to/pi-subagents`.

The package has no runtime dependencies of its own; Pi provides the host
packages. Run `npm ci` for the development tools.

## Start in 60 seconds

Copy the starter subagents you want:

```bash
mkdir -p ~/.pi/agent/subagents
cp subagents/*.md ~/.pi/agent/subagents/
```

Then use one command:

```text
/subagents <prompt>
```

Example:

```text
/subagents Find why the session screen drops its cursor and write a test.
```

Pi picks the smallest roster that fits the prompt (at most four), starts
the run, and shows it in the Runs tab. If the text is exactly a subagent
name, that subagent opens instead. Use `/subagents run <prompt>` when you
want the run path explicitly.

The other common paths are:

```text
/subagents team <prompt>    start a shared agent team
/subagents new              create a subagent
/subagents <name>           inspect or edit one subagent
```

## The board

```text
/subagents
```

The board opens in the editor area, with two tabs. Each run or task is
a card with a status glyph, a title, and one line of detail; the
selected card is outlined. The footer lists only the keys
that work on that card; `/subagents help` lists every key.

- **RUNS** — queued, running, done, stopped, and failed runs. On an empty
  board, press `enter` or `n` and type a prompt.
- **AGENT TEAM** — the shared task board. Press `t` to turn team mode on
  or off.

Common keys:

```text
↑↓ move       enter open       n run        f finish
s steer       x stop           r retry      c copy
tab switch    1 runs           2 team       e hidden
esc close
```

On the Team tab, `n` creates a task, `s` starts a team, `e` edits,
`a` assigns, `c` claims, `r` releases, `x` completes, and `enter`
opens the linked child run (`o` is an alias). The footer changes with
the selected task; `/subagents help` lists every key.

A run opens a read-only transcript with three tabs: transcript, tools,
and errors. `y` copies the visible tab, `/` searches, and `esc`
returns to the board. The viewer never changes the run.

## A subagent file

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

`description` is the short menu line. `model: inherit` uses the parent
model. `tools:` takes a preset (`read-only`, `edit`, `execute`) or a
tool list. `autonomy` is `inherit`, `off`, `low`, `medium`, or
`high`; lower levels clamp dangerous tools.

The body is the subagent's standing prompt. Keep it about how to work,
not about one task.

## Commands

| Command | What it does |
| --- | --- |
| `/subagents <prompt>` | Run the smallest matched roster (max 4). Unknown text starts a run. |
| `/subagents run <prompt>` | The same run path, written out. |
| `/subagents @a,@b <prompt>` | Run a named set. |
| `/subagents team <prompt>` | Start a team: one board task and worker per leg. |
| `/subagents team` | Open the Team tab. |
| `/subagents team on` / `off` | Let new task legs join the shared board, or stop new joins. |
| `/subagents new` | Create a subagent: quick or full settings. |
| `/subagents list` | Browse subagent files. |
| `/subagents tasks` | This session's runs. |
| `/subagents trash` | Restore a deleted subagent file. |
| `/subagents help` | The short help screen. |
| `/subagents <name>` | Open one subagent. |
| `/delegate <prompt>` | Run one prompt on explorer and worker. |

`finish`, `agent-team`, and `agent-teams` remain aliases. `/delegate`
keeps its own report and open commands.

## Limits and safety

- A run gets a fresh context. It does not see the parent transcript.
- `tools: read-only` cannot edit files. `edit` can change files.
  `execute` adds edit, write, and shell tools.
- `paths` fences writes to workspace-relative folders. A shell is not
  fenced, so a shell leg cannot use `paths`.
- MCP and the package's destructive-call gate are opt-in and need a
  medium or higher autonomy.
- Live runs default to 12; `liveCap` accepts 1–64. Extra legs wait in a
  queue.
- A run gets a 3,600 s timeout when no budget is set. `budget: { }`
  explicitly means no spending caps.
- A 900 s silence watchdog stops a hung child.
- Esc, `/reload`, or quitting Pi stops live children.
- `finishHook` can run one local shell command per finished run. It is
  read from user settings, or from a trusted project's settings, never
  from an agent file.

## Settings

Global defaults live in `~/.pi/agent/settings.json` (or
`.pi/settings.json`):

```json
{
  "pi-subagents": {
    "model": "provider/model",
    "tools": ["read", "grep"],
    "autonomy": "low",
    "budget": { "timeoutSec": 600 },
    "liveCap": 8,
    "roundBudgetTokens": 500000,
    "roundBudgetMinutes": 30,
    "codemode": "off",
    "settleNotify": true
  }
}
```

Settings replace the file's value; budgets merge key by key. A per-run
`Task` switch wins over both. Invalid values are ignored.

The full field reference, team controls, and advanced options are in
[Usage](docs/usage.md).

## Docs

- [Usage](docs/usage.md) — the user guide, from one prompt to teams.
- [Runtime](docs/runtime.md) — what happens inside a run.
- [Design](docs/design.md) — layers and trade-offs.
- [Budgets](docs/budgets.md) — limits and what a stopped run returns.
- [Codemode](docs/codemode.md) — scripting modes and workers.

## Develop

```bash
npm ci
npm run check
npm run arch
npm run e2e:fixtures
```

Pi loads the extension with jiti; there is no build step. The e2e fixture
suite uses a local fake provider and spends no model calls.

## License

MIT
