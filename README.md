# pi-subagents

Reusable subagents for Pi. A subagent is a Markdown file: YAML frontmatter
for its config, body for its system prompt. `Task` runs it in a fresh
context and returns one report. A `subagent` alias does the same for models
that know Pi's sample tool.

This package is not published to npm. It is meant to be used from a local
checkout.

## Requirements

- Pi 1.4.0 or newer
- Node.js 22.19 or newer

## Install (local)

Clone or copy this directory somewhere permanent, then install it by path:

```bash
pi install /path/to/pi-subagents
```

Restart Pi or run `/reload`. Check that Pi sees the package:

```bash
pi list
```

Pi records the package path in `~/.pi/agent/settings.json` and loads the
extension from that directory. Moving or deleting the directory breaks the
install. Run `pi install` again with the new path. Pi reads the files in
place, so after `git pull` you only need `/reload`.

Project scope is also available. Pi loads it only after you trust the
project:

```bash
pi install --local /path/to/pi-subagents
```

Try it without installing:

```bash
pi -e /path/to/pi-subagents
```

Remove it with:

```bash
pi remove /path/to/pi-subagents
```

This is a local package, so Pi does not install its dependencies. The only
bare imports are Pi packages the host provides. Run `npm ci` to get the
dev dependencies for tests and type checking.

Starters live in `subagents/`, but Pi does not load them from the package.
Copy the ones you want:

```bash
cp subagents/*.md ~/.pi/agent/subagents/     # or <repo>/.pi/subagents/
```

## Use

```markdown
---
name: reviewer
description: Reviews a diff for bugs, missing tests, and risky edits.
tools: read-only
autonomy: low
---
You review code. Report findings by severity with `file:line`, then name
the tests that would have caught each one. Do not edit files.
```

Ask Pi: "Use the subagent `reviewer` on the last commit." The model calls
`Task` with `subagent_type`, `description`, and `prompt`.

```text
/subagents          # mission control: RUNS and TEAM tabs
/subagents list     # files
/subagents new      # create one (10-step wizard)
/subagents tasks    # live and done runs
/subagents trash    # restore a deleted file
/subagents team     # open the TEAM tab
/subagents team on  # let new Task legs join the shared board
/subagents team off # stop new joins; keep the board
/subagents team <prompt> [@a,@b]  # one task and one worker per leg
/subagents finish <prompt> [@a,@b] # smallest matched roster (max 4)
/delegate <prompt>  # one prompt on explorer + worker
/delegate reports   # compact status of the latest delegate
/delegate report <name> # one leg's full report
/delegate open <name>   # one leg's live session
/delegate status        # live legs only
```

The lead follows one ladder: local work, then one `Task`, then
`/delegate` (or a parallel Task pair), then a team when work is shared or
has blockers. `Team { action: "start", prompt }` creates one board task
and one worker per leg for broad independent fan-out. The policy is a
prompt, not a hidden router.

Migration: `/team` → `/subagents team` (or the TEAM tab);
`/finish` → `/subagents finish` (or `f`). `/delegate` is unchanged.
Team fan-out now lives at `/subagents team <prompt>`.

Open a run's transcript with `/subagents tasks` → **Open session**, or
`/delegate open <name>` for one delegate leg. Live runs stream the answer as it is
written (`▍` marks the end), finished runs show the saved history, and
`esc` returns to the menu without touching the run. The view is
read-only; the newest 300 KB stays, older lines collapse into one
hidden row. Long tool output keeps Pi's 10-line preview and expands with
`ctrl+o`.

The viewer has three tabs (`1 transcript`, `2 tools`, `3 errors`), `y`
copies the visible tab, and `e` jumps to the next error. While any leg is
live, `/subagents` opens mission control: queued, running, done and
failed runs, grouped by run, with `enter` open, `s` steer, `x` stop, `r`
retry, `c` copy, and `f` finish. `tab` switches to the TEAM tab, where
`t` toggles team mode, `n` creates, `e` edits, `a` assigns, `c` claims,
`r` releases, `x` completes, `d` deletes, and `s` starts a team.
Pi's own footer shows `⇄` live progress; each settled leg posts one card
with its report behind `ctrl+o`.

Delegate legs and team starts are background parallel runs. Past the
live cap (default 12, `liveCap` 1–64) they wait in a queue and start as
slots free; nothing is dropped. Name legs with `@explorer,@tester` to
narrow a run. Team start creates one board task per leg, so a stopped run
leaves its queued tasks pending; delete them in the TEAM tab. Delegate
reports are one line per leg by default and cap at 200 rows; a 1000-leg
board sends about 13 KB instead of 1.4 MB.

## Configure

Four levels, highest first: per-run switch, `pi-subagents` settings, file
field, built-in default.

**File.** `/subagents list` → pick → **Edit** changes `description`,
`model`, `thinkingLevel`, `tools`, `paths`, `autonomy`, `promptPrefix`,
`codemode`, `mcp`, and each budget cap without touching the rest.

```yaml
codemode: off      # off | on | only (true/false also work)
mcp: true          # opt-in MCP; medium+ only, codemode on/only, no paths
budget: { timeoutSec: 600, maxReportChars: 4000 }
promptPrefix: "Map first. Cite file:line."
paths: [src, docs]  # optional: workspace-relative; outside, absolute, and symlink escapes refused; bash is off
```

`promptPrefix` is a fixed one-liner (≤400 chars) placed before every task
that subagent receives; the six starters ship one — `/subagents team <prompt>`, `Task`, each parallel leg, every chain
step, and resumes. It carries durable framing, never task-specific steps.

`only` (or omitted) gives scripting alone, `on` adds it beside normal
tools, `off` removes it. `mcp: true` opens the servers in `mcp.json` for
this child; scripts call them as `tools.mcp__<server>__<tool>`. Each live
leg opens its own connections. OAuth servers need a parent `/mcp` sign-in
first. MCP is refused with `autonomy` `off`/`low`, with `codemode: off`,
and with `paths`; MCP tools are not path-fenced.

**Run.** `Task` and `subagent` take per-run switches; the file is not
modified. They apply to single runs, fan-out, chains, and resumes.

```json
{
  "subagent_type": "worker",
  "description": "Quick review",
  "prompt": "…",
  "codemode": "off",
  "budget": { "timeoutSec": 300 }
}
```

**Settings.** `~/.pi/agent/settings.json`, or the project's
`.pi/settings.json`:

```json
{
  "pi-subagents": {
    "codemode": "off",
    "model": "acme/fast",
    "autonomy": "low",
    "liveCap": 8,
    "finishHook": "cat >> ~/pi-legs.ndjson"
  }
}
```

`model`, `tools`, and `autonomy` replace the file's value; `budget` merges
key by key. Invalid values are ignored, and the block is read on every
launch. `liveCap` (1–64) is the live-task ceiling. `finishHook` is a shell
command; it is read from user settings always, and from project settings
only when the folder is trusted. No agent file can set it. `"alias": false`
stops the `subagent` compatibility tool from registering; that one is read
at load, so `/reload` after changing it.

Defaults: `codemode: only`, `mcp: off`, inherited model, file tools,
`inherit` autonomy, `timeoutSec: 3600`. Safety limits: 12 live tasks by default
(`liveCap` 1–64), 900 s stall watchdog, 300 s wind-down, 10 s hard-stop
grace.

## Capabilities

- **Task / `subagent`** — one run, one report.
- **Background** — `run_in_background: true`; the finished leg wakes the
  parent with its report, so the parent ends its turn instead of polling.
- **Resume** — `resume: task_id` continues a done task; survives a restart.
- **Return** — `return: ["files", "risks"]` makes a single report end with
  those lines; only the final contiguous block counts, and missing fields
  auto-label the run `verification`.
- **Fan-out** — `parallel[]`, up to the live cap (default 12).
- **Team start / Delegate** — `/subagents team <prompt>` creates one board task
  and one worker per leg; each task inherits its subagent's `paths` as write
  scopes, and an unscoped leg warns. `/delegate` runs explorer + worker. Legs
  past the live cap wait in a queue.
- **Finish** — `/subagents finish <prompt>` (or `f` in RUNS) picks the
  smallest matched roster (max 4, never above `liveCap`).
- **Teams** — `/subagents team on` or the TEAM tab opens a shared
  board. `Team { action: "start", prompt }` also creates one task and one
  worker per leg. Every leg launched with `Task` joins under a unique name,
  can list/claim/complete tasks, message a teammate, and wait for a named
  run. Write scopes reserve paths while a task is in progress; a
  read-only `Team resolve` names the blocker, and a bounded session
  queue holds mail for a finished member. Tasks remember why they came
  back. Tasks survive `/reload`; ready tasks never start an agent.
- **Mission control** — one `/subagents` surface with RUNS and TEAM tabs,
  native footer progress, settled cards, and viewer tabs.
- **TaskControl** — `steer`, `stop`, and `retry` a task from the model or
  the board (`s`, `x`, `r`).
- **Paths fence** — a subagent may name workspace-relative folders it writes
  into; `write`/`edit` outside them, or through a symlink escape, are refused,
  and `bash`/`powershell` are off because a shell cannot be fenced.
- **Chains** — `chain[]`, fresh context per step.
- **Temp subagents** — `temp_definition`, session-only.
- **Codemode** — one script per turn, with a worker pool.
- **Guards** — timeout, turns, tokens, stall, wind-down, hard stop.
- **Stop** — Esc, reload, or quit stops every live run.
- **Finish signal** — the footer keeps each finished leg (`✓`, `✗`, `⊘`) for
  8 s, newest three plus `+N`.
- **Finish hook** — `finishHook` runs one shell command per finished leg
  with a JSON line: `event`, `task_id`, `subagent`, `status`, `ms`, `chars`,
  `model`, `cwd`, and `error` when it failed. User settings always; project
  settings only when the folder is trusted; never an agent file.
- **Failure label** — `TaskOutput(task_id, failure: "spec" | "coordination" |
  "verification")` labels a failed run once, never by inference;
  `/delegate reports` shows `[spec]` beside that leg.

## Docs

- [Usage](docs/usage.md) — fields, menus, delegation, fan-out, temp
  subagents, chains, persistence, starters.
- [Codemode](docs/codemode.md) — modes, worker pool, measured A/B.
- [Budgets and guards](docs/budgets.md) — ceilings, hard stop, stall,
  wind-down, token accounting.
- [Runtime](docs/runtime.md) — footer, compaction, stop, rules, 400,
  journal and watcher.
- [Design](docs/design.md) — layers, 250-line rule, harness growth,
  paper adoption.

## Develop

```bash
npm ci
npm run check   # format, lint, typecheck, tests
npm run arch    # architecture tests only
npm run coverage      # line/branch/function coverage, no gate
PI_IT_LIVE=1 PI_IT_MODEL=provider/model npm run smoke:live  # real Task/Team/steer/resume
npm run bench:launch   # local render and admission timings
npm run bench:layers  # viewer paint, streaming, and state save
npm run bench:finish  # roster pick latency over the six starters
PI_DELEGATE_E2E=1 npm run e2e:delegate # real RPC run (spends model calls)
npm run e2e           # real model delegate probe (spends model calls)
npm run e2e:fixtures  # full forced-answer suite: team start, delegate, defaults, chain, parallel, abort, viewer
npm run e2e:tui       # optional tmux viewer check (needs tmux)
```

Pi loads the extension with jiti, so there is no build step. `npm run
check` runs the formatter check, Oxlint, `tsc --noEmit`, and the test
suite. `npm run e2e` uses your configured model and spends calls.
`npm run e2e:fixtures` keeps the full forced-response suite in a temp home,
so it needs no keys or network. Failures write logs to `artifacts/e2e/`.

## License

MIT
