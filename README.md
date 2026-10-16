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
/subagents          # live runs
/subagents list     # files
/subagents new      # create one (10-step wizard)
/subagents tasks    # live and done runs
/subagents trash    # restore a deleted file
```

## Configure

Four levels, highest first: per-run switch, `pi-subagents` settings, file
field, built-in default.

**File.** `/subagents list` → pick → **Edit** changes `description`,
`model`, `thinkingLevel`, `tools`, `autonomy`, `codemode`, and each budget
cap without touching the rest.

```yaml
codemode: off      # off | on | only (true/false also work)
budget: { timeoutSec: 600, maxReportChars: 4000 }
```

`only` (or omitted) gives scripting alone, `on` adds it beside normal
tools, `off` removes it.

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
{ "pi-subagents": { "codemode": "off", "model": "acme/fast", "autonomy": "low" } }
```

`model`, `tools`, and `autonomy` replace the file's value; `budget` merges
key by key. Invalid values are ignored, and the block is read on every
launch.

Defaults: `codemode: only`, inherited model, file tools, `inherit`
autonomy, `timeoutSec: 3600`. Safety limits are fixed: 12 live tasks,
900 s stall watchdog, 300 s wind-down, 10 s hard-stop grace.

## Capabilities

- **Task / `subagent`** — one run, one report.
- **Background** — `run_in_background: true`, poll with `TaskOutput`.
- **Resume** — `resume: task_id` continues a done task; survives a restart.
- **Fan-out** — `parallel[]`, up to 12 independent legs.
- **Chains** — `chain[]`, fresh context per step.
- **Temp subagents** — `temp_definition`, session-only.
- **Codemode** — one script per turn, with a worker pool.
- **Guards** — timeout, turns, tokens, stall, wind-down, hard stop.
- **Stop** — Esc, reload, or quit stops every live run.

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
```

Pi loads the extension with jiti, so there is no build step. `npm run
check` runs the formatter check, Oxlint, `tsc --noEmit`, and the test
suite.

## License

MIT
