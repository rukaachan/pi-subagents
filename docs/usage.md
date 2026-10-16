# Usage

## Subagent file format

```markdown
---
name: explorer
description: Fast codebase search. Use for find and explain tasks.
model: inherit
tools: read-only
autonomy: low
---

System prompt body. Cannot be empty.
```

| Field            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name             | Required. `^[a-z0-9-_]+$`. Drives `subagent_type`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| description      | Advised. Shown in `/subagents`. Warns over 500 chars.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| model            | `inherit` (default) or `provider/id`. Unknown model falls back to parent with a note.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| thinkingLevel    | `off, minimal, low, medium, high, xhigh, max`. Ignored when model is `inherit`. `reasoningEffort` is accepted as an alias.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| tools            | Omit = all. Or `read-only`, `edit`, `execute`. Or a list of Pi tool IDs. `tools: all` is rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| autonomy         | `inherit` (default), `off`, `low`, `medium`, `high`. v2 clamp: `off` = read-only; read-only subagents never run above low.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| codemode         | Omitted = the run gets pi's codemode tool and the model sees it **alone**: every read, search, edit and command runs inside a script (one script can batch many calls per turn, Promise.allSettled). `only` says the same out loud, `true` keeps pi's default (the scripting tool beside the ordinary tools), `false` (or `off`) means no scripting at all, and `on` is the alias of `true`. A `Task` call may override the file for one run with `codemode: off                                                                                                                                                                                                                                            | on  | only`. The grant adds no capability: scripts reach the session's own tools only, so a read-only list stays read-only in every mode. A prompt that never mentions scripts gets the route appended. |
| budget           | `{ timeoutSec, maxTurns, maxInputTokens, maxReportChars }`. `timeoutSec` is the wall-clock ceiling and the only guard that needs nothing from the provider, so it binds on a hung request too; the starters ship `maxTurns: 0` and `maxInputTokens: 0` (off) and rely on it. The turn and token caps abort the stream and note it when a paid lane asks for them; `maxReportChars` cuts the returned text with an explicit `[truncated: …]` marker. A stopped run keeps the text it produced and only falls back to a `[cut short]` report — ceiling plus last steps — when it never spoke. The editor changes one cap at a time.                                                                           |
| budget opt-out   | `{ }` reaches the run as `{ }`: `parseBudget` used to fold an empty block into `undefined`, which is what an _absent_ block means, so the documented opt-out was silently dropped and the starter's caps stayed on. Absence still means "use the defaults".                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| budget (v0.13.3) | The turn cap binds on foreground, background, and resume legs alike. A throwaway-worktree simulation caught background legs bypassing the cap; `installTurnBudget` now arms every path. Sim verdict (real session, maxTurns 3, task demanding 8): run stopped at 3 turns, `_notes_` gained `turn budget 3 reached`, report 37 chars.                                                                                                                                                                                                                                                                                                                                                                        |
| Task budget      | Per-run override on Task/`subagent` that **merges** onto the subagent's own budget: `budget: { maxReportChars: 12000 }` raises that cap and leaves the 5,400s timeout alone; `0` turns a single cap off; `budget: { }` clears them all for one run; omitting the field keeps the subagent's budget untouched. Unknown keys and non-integers are rejected outright. (It replaced the whole budget once: a one-field override silently dropped worker's 5,400s back to the 3,600s default.)                                                                                                                                                                                                                   |
| editor           | `/subagents` → Edit offers description, model, thinkingLevel, tools, autonomy, codemode, and each budget cap. A pick or input rewrites only that field, so the rest of the file (including a budget it does not touch) survives.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| watch            | `node tools/watch.mjs` tails the run journal in a second terminal: per-run status, turns (completed), elapsed, current step (`bash · go test ./...`), report size, `!cap` when the turn budget bound. `--once` prints one table; `--json` prints folded rows. Journal writes one NDJSON line per start/turn/tool/end event to `~/.pi/agent/pi-subagents-journal.ndjson` (bounded at 2 MB, rotates to `.1`); `PI_SUBAGENTS_JOURNAL=off` disables it, `PI_SUBAGENTS_JOURNAL=<path>` redirects it. `run_end` also carries `gapMaxSec` (longest silence between any two session events) and `gapOver60` (silences of a minute or more), so the stall floor can be re-fitted with `npx tsx tools/stall-fit.mts`. |

Tool groups:

| Group     | Tools                   |
| --------- | ----------------------- |
| read-only | read, grep, find, ls    |
| edit      | read-only + edit, write |
| execute   | edit + bash             |

Validator: bad name, empty body, unknown tool, bad model shape, bad level, bad autonomy = error, subagent skipped. Missing description, duplicate tools, thinkingLevel with inherit = warn, subagent loads.

### Global policy

An operator who wants one policy everywhere does not edit every file.
Put it in settings — `~/.pi/agent/settings.json`, or the project's
`.pi/settings.json`:

```json
{
	"pi-subagents": {
		"codemode": "off",
		"model": "acme/fast",
		"tools": "read-only",
		"autonomy": "low",
		"budget": { "timeoutSec": 600 }
	}
}
```

| key        | accepted                                                   | effect                                                  |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| `codemode` | `off`, `on`, `only`, `true`, `false`                       | replaces the file's mode                                |
| `model`    | `inherit` or `provider/id`                                 | replaces the file's model                               |
| `tools`    | a group or a tool list, as in the file                     | replaces the tool policy; the autonomy clamp still runs |
| `autonomy` | `inherit`, `off`, `low`, `medium`, `high`                  | replaces the file's autonomy                            |
| `budget`   | `{ timeoutSec, maxTurns, maxInputTokens, maxReportChars }` | merges key by key over the file's budget                |

Every key is optional, and an invalid value is ignored instead of
failing a run. The block is read for every launch, so a change takes
effect on the next run without a restart.

Precedence, highest first:

1. the per-run switch on `Task` (or `subagent`): `codemode`, `model`,
   `budget`, `complexity`.
2. the `pi-subagents` settings block.
3. the file's own field.
4. the built-in defaults (`codemode: only`, inherited model, file tools,
   `inherit` autonomy, `timeoutSec: 3600`).

It applies to single runs, fan-out legs, chain steps, session-temp
subagents, alias calls, and resumes. Remove a key to let files decide
again.

## Use

```
/subagents             # runs that are live right now
/subagents list        # the subagent files (detail + Edit/Delete)
/subagents explorer    # open one subagent (detail + Edit/Delete/Back)
/subagents new         # 10-step wizard: home, name, starter, desc, model, tools, level, autonomy, codemode, timeout
/subagents tasks       # live and done runs with use + cost
/subagents trash       # trashed files; restore from the picker
```

Type `/subagents ` and Pi completes list, new, tasks, trash, and names.
Edit changes description, model, thinkingLevel, tools, autonomy, codemode,
and each budget cap through picks; it rewrites only the field you pick.

The bare command answers one question: what runs now. It lists
live runs, and a pick opens that run. When nothing runs, it says
so and names the commands that manage files. It never shows a
file list on its own, so the count of your subagents stays out of
the way. Ask for `/subagents list` when you want that list.

Every menu is a one-line-per-row picker: a short label column
(name, badge, source glyph) and a muted description that ends in
`…` instead of wrapping. `j`/`k` move like ↑/↓.

Open a run and the header shows its last three steps — `bash ·
go test ./...`, `read · src/runner.ts`, `edit · src/subagents.ts`
— newest last, one line each, cut to the width. A call made inside a
script sits under the script that ran it (`codemode · read ·
src/runner.ts`), so a `codemode: only` run never looks like the model
called the tool itself. A parallel group
names the leg that did each step (`worker#1 · bash · …`). The rows
come from the live tracker while the run is in flight and from the
run journal after a restart, so the same three rows survive one. On the plain
`select` path (no custom UI) the same rows fall back to labels. Delete moves the file to `~/.pi/agent/subagents/.trash/`
with a date stamp. Open Trash to bring one back to personal or
project. Closed fields use picks: tools, level, autonomy, and
model (live list from your registry + inherit + custom).
Task rows show status, label, turns, tokens, cost; pick one for
full text, then copy its id with one act.

Ask Pi to delegate:

```
Use the subagent `explorer` to map the auth code.
```

### Delegating without asking

Task and `subagent` carry a **delegation rule** as a tool
`promptGuidelines` entry (`DELEGATION_RULE`, `src/tools/task/meta.ts`),
so the model sees it on every request and does not need the operator to
write "use a subagent" each time:

> Delegate with Task when the work spans 3+ files or 2+ modules, needs
> more than about 8 tool calls, splits into independent parts (use
> parallel), or runs a command longer than about 2 minutes. Keep it local
> for a one-file change, or when the answer decides your next step.

Both tools carry the same sentence; pi dedupes identical rules, so the
prompt shows it once. Measured (`tools/guideline-probe.mts`): in codemode
`on` the rule lands in `<rules>` (+303 chars, 2037 → 2340); in `only` the
tool is hidden, so the same text rides inside the `codemode` description
and the system prompt is unchanged (2016 chars).

Measured effect (`tools/delegation-probe.mts`): 72 real sessions, three
prompt sets (concrete, vague, and vague inside a 24-turn seeded history
with 8 extra tools), a stub Task so the probe measures the decision and
not subagent work, 4 heavy and 2 light prompts per cell:

| arm             | heavy delegated | light delegated | correct |
| --------------- | --------------- | --------------- | ------- |
| `on`, no rule   | 10/12           | 2/6             | 14/18   |
| `on`, rule      | 11/12           | 2/6             | 15/18   |
| `only`, no rule | 11/12           | **6/6**         | 11/18   |
| `only`, rule    | 12/12           | **4/6**         | 14/18   |

What the numbers say, including what they do not:

- The rule is **not** what makes delegation happen: with the tool
  description alone the model already delegates 10–11 of 12 heavy
  prompts. The honest claim is smaller.
- Its clearest effect is **restraint in `only` mode**: light prompts went
  from 6/6 delegated to 4/6, so the "keep it local" clause bites where
  the model otherwise reaches for Task to avoid writing a script.
- Heavy delegation rose by one in each mode (10→11, 11→12). With six
  prompts per cell that is one session, not a trend.

Foreground Task params: `subagent_type` (required), `description` (required), `prompt` (required).
Alias params: `agent` + `task`, plus `chain`, `budget`, `model`, `complexity`,
and `codemode`; background, resume, tasks[], and parallel say no.
Both tools forgive guessed shapes: `agent`/`subagent`/`name` map to the name,
`task`/`prompt`/`description` map to the text, `background` maps to
`run_in_background`. Truly empty calls get one clear error, not a schema dump.
If Pi says `Tool subagent not found`, the pack is not installed in that
session — see [Install (local)](../README.md#install-local) and retry.
Unknown names suggest the near match: `Unknown subagent "explore". Did you mean "explorer"?`

Background: add `run_in_background: true`. Task returns a `task_id` now.
Poll with the `TaskOutput` tool (`task_id` required). Full text comes once
on the first done poll; later polls say done short. Max 12 live tasks (fan-out legs share this cap; a larger fan-out is refused, so split it into batches).

Resume: pass `resume: task_id` plus a new `prompt` with the same
`subagent_type`. The follow-up run keeps prior history. A done task
resumes after a Pi restart: its row and history persist on disk.

Per-run switches on `Task` and the `subagent` alias: `model`, `budget`,
`codemode` (`off`, `on`, `only`, or `true`/`false`), and `complexity`.
They apply to single runs, fan-out legs, chain steps, and resumes; they
change that call only, and the file on disk is untouched. They sit at the
top of the precedence chain described above; the settings block is next.

## Tool paint

- Task result: `✓ Task` + turns, tokens, cost; fail shows `✗` + short cause.
- TaskOutput result: `…` + turns/s/tool while running, `✓` + use when done, `✗` on fail.

## Nameless dispatch

Task works without a subagent name. Omit `subagent_type` (and
`chain`/`parallel`) and an ordered rule table picks from the
prompt text: review → code-reviewer, test → tester, research →
researcher, plan → planner, find/map → explorer, fix/implement →
worker, in that priority order. Worker is the fallback tier: its
verbs ("review the login fix") yield to a specialist in the same
sentence. The pick always echoes the rule and keyword that fired
in the result details (`dispatch`), so a wrong route is visible,
never silent. Two specialist rules in one prompt ("review the
test results") is ambiguous and fails fast with the roster; so
does a prompt that matches no rule. Named calls keep the exact
behavior they had before.

### Fan-out from one task

Many independent targets in one task (8 files, N modules) are one
decision, and the caller makes it: read the task once, see that the
legs are independent, and fire them as one `parallel` call with
per-leg prompts. The tool description now says that in so many
words, because the machinery was already there — what was missing
was the instruction to use it.

One defect shipped with this and one was closed. The defect closed:
legs beyond the live cap used to get a fake id (`(queued, cap 12)`)
and never ran — silent leg loss on exactly the workflow fan-out is
for (`fanoutAdmission` in `src/dispatch.ts`, pure and tested). A
call over 12 legs is refused up front with a batching instruction,
and a mid-loop cap collision names the legs that did not start.
The defect shipped: a fan-out decision belongs to the caller that
holds the roster, not to a keyword heuristic — per-sentence
auto-splitting would guess, and a wrong split burns real money on
paid models.

### Settled (measured Oct 21, 2026): the leg-launch loop is not the cost

A latency audit measured the hot paths and the real journal (93 runs).
Code contributes under 0.05% of run wall-time: roster discovery
0.88 ms/op, a journal append 0.006 ms, the turn budget guard under
0.001 ms per turn — nothing here justifies a cache. The time is the
model: turn-to-turn median 7.5 s (n=2,651 turns), and runs run 18–26
turns.

One lever was parked at the exact site: `runParallelTask` awaits each
leg, and 11 real legs took 4.7 s to reach `run_start`, so the loop
looked like the cause. **It is not.** Measured directly:

| what                                | cost                                |
| ----------------------------------- | ----------------------------------- |
| `launchBackground` per leg (8 legs) | 0–3 ms each, **8 ms total**         |
| loop total for 8 legs               | 8 ms                                |
| `startSubagentSession` per child    | 9–18 ms, all concurrent             |
| `run_start` latency per leg         | 70 ms, then 222–240 ms for the rest |

The 4.7 s the journal showed is `startSubagentSession` running inside
each detached block plus real model variance, not the awaits. A
`Promise.all` here would save single-digit milliseconds out of a
239 s median parallel run, and it would make the store mutation
concurrent for no gain. **The loop stays serial on purpose**, and the
comment above it records this falsification so the idea is not raised
again without new numbers.

### Session-temp subagents (grill 2026-10-20)

The model can now compose its own specialist and run the task with
it in the same call: pass `temp_definition {name, description,
systemPrompt, model?, tools?, codemode?, budget?}` to `Task`. The
definition registers for the session and is reusable by name --
single calls, chains, fan-out legs. Hard rules, all ratified in the
grill session before a line was written:

- **Nothing is written to disk.** A temp lives in a process registry
  and dies with the session. The roster on disk stays user-owned
  (wizard only); no approval queue is needed because nothing
  persists.
- **The prompt cap is 20 lines x 120 characters**
  (`MAX_TEMP_PROMPT_LINES`, `MAX_TEMP_PROMPT_LINE_CHARS` in
  `src/temp.ts`). A fat line is circumvention, not 20 lines -- the
  checker names the offender line and its length.
- **Locked fields.** Autonomy is never set by the model (the system
  default flows into `clampToolsForAutonomy` at launch); a temp name
  never shadows a persistent starter; no child carries `Task`, so
  nesting stays impossible.
- **Identity is loud.** Temp rows badge "temp name" in the tasks
  menu and details read `temp (session-scoped)`, so an ephemeral
  worker never passes for a persistent one; ledger stats stay clean
  because validation refuses the persistent roster's names.
- **Errors name the offender, parseBudget-style:** refused calls
  return the exact rule broken, and re-registering a name replaces
  the entry last-wins and echoes `replaced`.

Naming defect this closes: without it the model was bound to the
fixed roster -- no way to express a one-off custom specialist
("you are a triage doctor for this repo, run until N tokens")
without writing a starter file, which the earlier grill forbade as
unchaperoned self-modification. The temp split unlocks the
composition while keeping persistence behind the wizard.

## Chains (v0.8)

Run subagents in order with one call:

```
Task(subagent_type: "explorer", description: "ship login",
     prompt: "Add login",
     chain: ["explorer", "worker", "code-reviewer"])
```

The `subagent` alias accepts `chain` too.
Each step gets the prior step's report as context (cut at 8000 chars).
One chain = one `task_id`, one live slot, one row. Steps stop at the
first error; later steps stay `pending`. Poll a live chain with
`TaskOutput` to see the step strip: `explorer ✓ → worker … → reviewer ·`.
Chains restart as a new Task — steps do not resume alone.

## Complexity and model (v0.8)

- `complexity`: `light` (low), `medium` (medium), `heavy` (high) sets
  the thinking tier for one run. An explicit `thinkingLevel` in the
  subagent file still wins.
- `model`: override the model for one run, e.g. `model: "acme/fast-1"`.
  The file on disk is never changed.

## Persistence (v0.8)

Tasks and spawn counts survive a Pi restart at
`~/.pi/agent/pi-subagents-state.json` (atomic write, 2 MB cap, oldest
rows drop first). Done rows stay pollable and resumable. Live rows
cannot survive: their child sessions are gone, so restore marks them
`error — interrupted by Pi restart` and drops the kept history.

## Live partial output (v0.8)

A running poll and the footer now carry the last assistant snippet, so
`TaskOutput` shows what the child just said, not only turns and time.

## Starters

`explorer`, `worker`, `code-reviewer`, `planner`, `researcher`, `tester` —
copy from `subagents/` into `~/.pi/agent/subagents/`.

Each one follows the same shape, so you can trust any of them the
same way:

- **Stance** — one line naming the role and its context.
- **Method** — how it works, in the order it works.
- **Evidence** — what counts as proof, and what does not.
- **Scope** — what it must not do. Read-only agents change no file.
- **Report** — the fixed shape of its answer back to you.
- **Failure clause** — what it does when blocked: report, never ask.

`read-only` agents (`explorer`, `planner`, `code-reviewer`,
`researcher`) run with exactly the `read-only` tool group:
`read`, `grep`, `find`, `ls`. `tester` adds `edit`, `write`, `bash`.
`worker` keeps all tools. `tests/prompts.test.ts` guards this shape.

## v3 roadmap

- Full autonomy gates (confirm before risky tools)
- Import from Claude Code agents
