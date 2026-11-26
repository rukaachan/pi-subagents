# Usage

## Subagent file format

```markdown
---
name: explorer
description: Fast codebase search. Use for find and explain tasks.
model: inherit
tools: read-only
autonomy: low
promptPrefix: Map the code before answering. Cite file:line.
---

System prompt body. Cannot be empty.
```

| Field            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name             | Required. `^[a-z0-9-_]+$`. Drives `subagent_type`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| description      | Advised. Shown in `/subagents`. Warns over 500 chars.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| model            | `inherit` (default) or `provider/id`. Unknown model falls back to parent with a note.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| thinkingLevel    | `off, minimal, low, medium, high, xhigh, max`. Ignored when model is `inherit`. `reasoningEffort` is accepted as an alias.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| tools            | Omit = all. Or `read-only`, `edit`, `execute`. Or a list of Pi tool IDs. `tools: all` is rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| paths            | Optional write fence: one workspace-relative folder, a comma list, or a YAML list. Absolute roots, parent roots, and symlink escapes are refused. `write` and `edit` refuse any path outside it. `bash` and `powershell` are switched off while the fence is on, because a shell can write anywhere. Omit = no fence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| autonomy         | `inherit` (default), `off`, `low`, `medium`, `high`. This is enforced, not a note: `off` and `low` are read-only (no shell, edit, write, or MCP); `medium` removes shell; `high` keeps shell unless `paths` is set. The table below is the exact policy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| promptPrefix     | One line (≤400 chars) put in front of every task this subagent gets, then a blank line, then `Task: <prompt>`. The six starters ship one. It is applied where the child session is prompted, so agent-team start, `Task`, `parallel` legs, every chain step, and resumes all see their own subagent's prefix. Use it for durable framing ("cite file:line", "run the checks before reporting"), not for steps that belong to one task. Blank means none. Invalid or over 400 chars = error, subagent skipped.                                                                                                                                                                                                                                                                                                                                                  |
| codemode         | Omitted = the run gets pi's codemode tool and the model sees it **alone**: every read, search, edit and command runs inside a script (one script can batch many calls per turn, Promise.allSettled). `only` says the same out loud, `true` keeps pi's default (the scripting tool beside the ordinary tools), `false` (or `off`) means no scripting at all, and `on` is the alias of `true`. A `Task` call may override the file for one run with `codemode: off                                                                                                                                                                                                                                                                                                                                                                                               | on  | only`. The grant adds no capability: scripts reach the session's own tools only, so a read-only list stays read-only in every mode. A prompt that never mentions scripts gets the route appended. |
| budget           | `{ timeoutSec, maxTurns, maxInputTokens, maxCost, maxReportChars }`. `timeoutSec` is the wall-clock ceiling and the only guard that needs nothing from the provider, so it binds on a hung request too; the starters ship `maxTurns: 0`, `maxInputTokens: 0`, and `maxCost: 0` (off) and rely on it. The turn, token, and cost caps abort the stream and note it when a paid lane asks for them; `maxCost` reads the provider-reported cost and accepts a fractional cap. When the provider reports 0, the guard stays idle and says so. `maxReportChars` cuts the returned text with an explicit `[truncated: …]` marker. A stopped run keeps the text it produced and only falls back to a `[cut short]` report — ceiling plus last steps — when it never spoke. The editor changes one cap at a time.                                                       |
| budget opt-out   | `{ }` reaches the run as `{ }`: `parseBudget` used to fold an empty block into `undefined`, which is what an _absent_ block means, so the documented opt-out was silently dropped and the starter's caps stayed on. Absence still means "use the defaults".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| budget (v0.13.3) | The turn cap binds on foreground, background, and resume legs alike. A throwaway-worktree simulation caught background legs bypassing the cap; `installTurnBudget` now arms every path. Sim verdict (real session, maxTurns 3, task demanding 8): run stopped at 3 turns, `_notes_` gained `turn budget 3 reached`, report 37 chars.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Task budget      | Per-run override on Task/`subagent` that **merges** onto the subagent's own budget: `budget: { maxReportChars: 12000 }` raises that cap and leaves the 5,400s timeout alone; `0` turns a single cap off; `budget: { }` clears them all for one run; omitting the field keeps the subagent's budget untouched. Unknown keys and non-integers (except `maxCost`, which accepts a fraction) are rejected outright. (It replaced the whole budget once: a one-field override silently dropped worker's 5,400s back to the 3,600s default.)                                                                                                                                                                                                                                                                                                                         |
| mcp              | `true` or `on` opens the configured MCP servers in this child; omitted/off stays closed. Requires `autonomy` `medium` or higher, `codemode` `on`/`only`, and no `paths` fence. Tools are reached inside a script as `tools.mcp__<server>__<tool>`. Each live leg opens its own connections; OAuth servers must be signed in from the parent first. MCP tools are not path-fenced. Pi's host confirm hooks do not run in a child; add `gates: on` for the package deny list.                                                                                                                                                                                                                                                                                                                                                                                    |
| gates            | `on` installs the package's own tool gate in this child; omitted/off loads nothing. Requires `autonomy` `medium` or higher (a read-only child has nothing to gate) and is allowed with `paths`. It **blocks, it never prompts**: a child binds no UI, so a confirm would hang the leg. Denied on `bash`/`powershell`: `rm -rf`/`--recursive`, `sudo`, `mkfs`, `dd of=/dev/…`, `shutdown`/`reboot`, `chmod`/`chown … 777`, `git push --force`, `git reset --hard`, `git clean -fdx`, and writes to `/dev/sd*`. Other tools are denied when they declare `destructiveHint`, so a destructive MCP tool is covered. A nested call from a codemode script is gated too. The block reason is `gates: <what>. Narrow the task or turn gates off.`, and each block writes one `gate` line to the journal. It is a fixed deny list, not the parent's own confirm rules. |
| context          | `on` loads project context files (AGENTS.md from the agent dir, the cwd, and its parents) into this child; omitted/off keeps the child context-free. Allowed for read-only children too, because it only adds text. The run notes the cost before the first turn: `context: 2 files, 8421 chars (AGENTS.md, src/AGENTS.md)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| editor           | `/subagents` → Edit offers description, model, thinkingLevel, tools, autonomy, promptPrefix, codemode, mcp, gates, context, and each budget cap. A pick or input rewrites only that field, so the rest of the file (including a budget it does not touch) survives.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| watch            | `node tools/watch.mjs` tails the run journal in a second terminal: per-run status, turns (completed), elapsed, current step (`bash · go test ./...`), report size, `!cap` when the turn budget bound. `--once` prints one table; `--json` prints folded rows. Journal writes one NDJSON line per start/turn/tool/end event to `~/.pi/agent/pi-subagents-journal.ndjson` (bounded at 2 MB, rotates to `.1`); `PI_SUBAGENTS_JOURNAL=off` disables it, `PI_SUBAGENTS_JOURNAL=<path>` redirects it. `run_end` also carries `gapMaxSec` (longest silence between any two session events) and `gapOver60` (silences of a minute or more), so the stall floor can be re-fitted with `npx tsx tools/stall-fit.mts`.                                                                                                                                                    |

Tool groups:

| Group     | Tools                   |
| --------- | ----------------------- |
| read-only | read, grep, find, ls    |
| edit      | read-only + edit, write |
| execute   | edit + bash             |

`autonomy` decides the ceiling, then the declared list chooses inside it:

| autonomy  | result                                                                   |
| --------- | ------------------------------------------------------------------------ |
| `off`     | exactly `read, grep, find, ls`                                           |
| `low`     | exactly the read-only group; codemode may be added, MCP is stripped      |
| `medium`  | declared tools minus `bash`/`powershell`; no list = the edit group       |
| `high`    | declared tools; no list = all tools; shell off when `paths` is set       |
| `inherit` | declared tools; no list = the host default; shell warns about host gates |

A `medium` list that is only shell falls back to read-only instead of a
child with no tools. A read-only list above `low` still gets the
read-only tools and a note; the clamp never widens a list.

Validator: bad name, empty body, unknown tool, bad model shape, bad level, bad autonomy, invalid `mcp`/`gates`/`context`, or an MCP/gate combination the policy rejects = error, subagent skipped. Missing description, duplicate tools, thinkingLevel with inherit = warn, subagent loads.

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
		"budget": { "timeoutSec": 600 },
		"liveCap": 8,
		"finishHook": "cat >> ~/pi-legs.ndjson"
	}
}
```

| key            | accepted                                                            | effect                                                     |
| -------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `codemode`     | `off`, `on`, `only`, `true`, `false`                                | replaces the file's mode                                   |
| `model`        | `inherit` or `provider/id`                                          | replaces the file's model                                  |
| `tools`        | a group or a tool list, as in the file                              | replaces the tool policy; the autonomy clamp still runs    |
| `autonomy`     | `inherit`, `off`, `low`, `medium`, `high`                           | replaces the file's autonomy                               |
| `budget`       | `{ timeoutSec, maxTurns, maxInputTokens, maxCost, maxReportChars }` | merges key by key over the file's budget                   |
| `alias`        | `true`, `false`, `on`, `off`                                        | registers the `subagent` alias tool (read at load)         |
| `liveCap`      | integer `1`–`64`                                                    | live-task ceiling; extra legs queue                        |
| `settleNotify` | `true`, `false`, `on`, `off`                                        | wake the parent when a background leg settles (default on) |
| `finishHook`   | a shell command                                                     | one JSON line per finished leg (settings only)             |

Every key is optional, and an invalid value is ignored instead of
failing a run. The block is read for every launch, so a change takes
effect on the next run without a restart — except `alias`, which changes
tool registration, and `liveCap`'s codemode pool, which is fixed at load;
both need `/reload`.

`finishHook` is the one key with a trust gate: user settings always apply,
project settings only when the folder is trusted. Agent files cannot set
it.

The model is `inherit` unless a file, this block, or a per-run switch says
otherwise, so routing a subagent to a cheaper model is a one-line change:

```json
{ "pi-subagents": { "model": "acme/fast" } }
```

Set it per file with `model: provider/id` when only one starter should move.

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
/subagents             # mission control: RUNS and AGENT TEAM tabs (opens with no runs)
/subagents list        # the subagent files (detail + Edit/Delete)
/subagents explorer    # open one subagent (detail + Edit/Delete/Back)
/subagents new         # 10-step wizard: home, name, starter, desc, model, tools, level, autonomy, codemode, timeout
/subagents tasks       # live and done runs with use + cost
/subagents trash       # trashed files; restore from the picker
/subagents agent-teams        # open the AGENT TEAM tab
/subagents agent-teams on     # whole session becomes an agent team; new legs join
/subagents agent-teams off    # stop new legs from joining; keep the board
/subagents agent-teams <prompt> [@a,@b]  # agent-team start: one task and one worker per leg
/subagents finish <prompt> [@a,@b] # smallest matched roster (max 4), background
/delegate <prompt>     # one prompt on explorer + worker
/delegate @a,@b <prompt> # a named pair
/delegate reports      # compact status of the latest delegate
/delegate report <name>  # one leg's full report
/delegate open <name>    # one leg's live session
/delegate status         # live legs only
```

The lead reads one hybrid policy on every turn: local work first, then one
`Task`, then `/delegate` (or a parallel Task pair), then an agent team when work
is shared or has blockers. `AgentTeam { action: "start", prompt }` creates one
board task and one worker per leg for broad independent fan-out. The
policy is a prompt; there is no hidden router.

### Migration note

The v4 surface is breaking on purpose, except the command aliases below.

- old tool `Team` → `AgentTeam`; `TeamMessage` → `AgentTeamMessage`
- restart Pi after upgrading so the new tool names load
- `/team` → `/subagents agent-teams` (or the AGENT TEAM tab)
- `/subagents team` and `/subagents agent-team` still work as aliases
- agent-team fan-out → `/subagents agent-teams <prompt> [@a,@b]`
- `/team on|off` → `/subagents agent-teams on|off` (or `t` in AGENT TEAM)
- `/finish` → `/subagents finish` (or `f` in RUNS)

Saved state and the journal use the new names (`agentTeam`, `agentTeamId`,
`agent_team_task`, `agent_team_message`). Run
`node --experimental-strip-types tools/migrate-agent-team.mts --write` once to
rewrite old files; it is a dry run by default, `--verify` reports leftovers,
and it keeps a `.pre-agent-team.bak` beside each file. `/delegate` is unchanged.

### Inside a run

`/subagents tasks` → a run → **Open session** reads the child's
transcript full screen: your task, its messages, each tool call, and
each tool result. `/delegate open <name|task-id>` opens the same view for
one delegate leg. An agent-team leg is a board task; use `TaskOutput` for
its report. A live run
repaints as it works, including the assistant text still being written
(`▍` marks the end), so you see the answer stream instead of waiting
for the message to finish. A finished run shows the saved history.

The viewer has three tabs: `1 transcript`, `2 tools`, `3 errors`; `y`
copies the visible tab, `e` jumps to the next error, and `esc` returns.

Search the transcript with `/`: type a literal phrase (case does not
matter, regex is not used) and press `enter`. The header shows `3/12`,
`n` and `N` step through the hits, and a miss says `no match`. While the
input is open `esc` cancels only the input; `esc` outside search still
closes the viewer.

`/subagents` opens mission control even when nothing runs. The RUNS tab
shows queued, running, done, stopped and failed runs, grouped by run. Keys:
`↑↓` move, `enter` open, `s` steer, `x` stop, `r` retry, `c` copy,
`f` finish, `tab` switch to AGENT TEAM, `esc` back. The footer lists only the
keys that work for the selected row, so a done row does not advertise
steer or retry. On a wide terminal the right pane shows the selected
run's last three steps, says `waiting for the first step` before any
arrive, and pins that row's keys to its bottom line. Failed runs stay
collapsed beside stopped runs; the title still counts them, and `e` shows
or hides both. The
AGENT TEAM tab shows one row per board task and keeps every board action:
`t` agent team on/off (also shown as `(t)` beside the counts),
`n` new, `e` edit, `a` assign, `c` claim, `r` release, `x` complete,
`d` delete, `s` start, `enter` detail, `o` opens the run linked to the
task. The detail pane shows `run <id>` and the task result; a task the
board did not launch says `no run linked` and does not offer `o`. Pi's own footer shows `⇄` live
progress, including legs that wait for a slot, and clears when the board
is idle. The board takes only the lines it needs, and on a wide terminal
it shows a selected-task or selected-run pane instead of leaving the
right side empty. The title carries the live counts on its left, and the
key hint sits in its own box at the bottom. Each settled leg posts one card (status, time, turns,
tokens, cost); `ctrl+o` shows its report.

Long tool output follows Pi's own rule: the newest 10 lines stay visible
with `... (N more lines, ctrl+o to expand)`. `ctrl+o` expands or collapses
every result in the view, so the transcript stays readable without losing
the full output.

Scroll with `↑↓`/`PgUp`/`PgDn`, jump with `g`/`G`, toggle tail-follow
with `f`, and `esc` returns to the run menu without touching the run.
While you are scrolled away the footer counts new messages (`↓2 new`);
`G` or `f` returns to the tail and clears the count. The view is
read-only: nothing you type reaches the child. Chains and parallel
groups have no single session of their own: open a leg row instead.
Without a TUI the same text arrives as a plain notice.

The viewer keeps the newest 300 KB (at most 400 entries); older lines
collapse into a single "… N earlier entries hidden" row. Bodies stay
whole, including newlines, so long tool output is readable instead of
flattened.

Agent-team legs are ordinary parallel runs, and each one owns a board
task. The host keeps `liveCap` legs live (default 12), so a larger roster
is queued instead of dropped: finished legs free a slot and the next one
starts. A stopped run leaves its queued tasks pending; delete them in the
AGENT TEAM tab. The AGENT TEAM tab is the agent team's report surface: each task carries
its status, owner, revision, scopes, and last error.
`/delegate reports` keeps the compact one-line-per-leg report (state,
elapsed, turns, tokens, cost), capped at 200 rows. Drill into a delegate
leg with `/delegate report <name>` or open its session with
`/delegate open <name>`. Poll a single task with `TaskOutput`.

Codemode workers match the live cap (one per leg), so a full board
never makes a script wait for a free worker.

`/subagents finish` takes at most four legs. Extra names are printed as
not started instead of being dropped silently; the cap never rises above
`liveCap`. The `f` key asks for the same prompt in RUNS.

`/subagents agent-teams <prompt>` with no roster uses every discovered subagent,
creates one task per leg, and enables agent team mode if it was off. `/delegate` with
no names uses `explorer` and `worker`; name a pair to replace them.
Delegate keeps its own latest run for `reports`; an agent-team run is read on
the AGENT TEAM tab.

Measured (`npm run bench:launch`, local):

| legs | compact render | old all-bodies render | payload         |
| ---- | -------------- | --------------------- | --------------- |
| 12   | 0.02 ms        | 0.03 ms               | 16 KB → 0.8 KB  |
| 100  | 0.14 ms        | 0.22 ms               | 137 KB → 6 KB   |
| 1000 | 1.0 ms         | 2.4 ms                | 1.37 MB → 13 KB |

`npm run e2e:delegate` runs the real delegate path over Pi's RPC mode:
admission in about 0.75 s, footer painted in the same tick, a 2-leg run
settled in 2–4 s, and a 271-char compact report.

`npm run e2e` runs the real-model delegate probe and spends calls.
`PI_IT_LIVE=1 PI_IT_MODEL=provider/model npm run smoke:live` checks one
Task, one AgentTeam start, one steer, one resume, and one gated `bash` call
against a real provider;
it is manual/nightly and never a CI gate. `npm run coverage` prints Node's
line, branch, and function coverage without a percentage gate.
`npm run e2e:fixtures` copies fixtures into a temp home, starts a local
fake provider, and checks agent-team start admission, the queue, hook lines, failure
labels, chain, parallel, abort, and the shipped defaults
(`/subagents agent-teams <prompt>` with no roster runs all six starters; `/delegate`
runs explorer and worker). It spends no model calls
and leaves your real home alone.

`npm run bench:layers` measures the viewer and the state save. On this
machine an appended message costs 0.3–0.4 ms to paint instead of 46 ms
for a full rebuild (105–176x), shaping one message costs 0.4–0.7 ms
instead of 19–25 ms for the whole history (35–48x), a 4 KB streaming
frame costs 1–1.5 ms, and a warm state save is 45–47x faster than a
cold one. The run's
wall time is still model-bound: one turn per leg costs seconds, so no
viewer change can make a 2 s leg finish in 20 ms.

Type `/subagents ` and Pi completes list, new, tasks, trash, and names.
Edit changes description, model, thinkingLevel, tools, autonomy,
promptPrefix, codemode, mcp, and each budget cap; it rewrites only the field
you pick. A `promptPrefix` is quoted on write, so a colon or a `#` in the text
cannot break the frontmatter.

The bare command opens mission control even when nothing runs. RUNS
lists live and finished runs; a pick opens that run. AGENT TEAM is always one
tab away. When nothing runs, RUNS says so and names the commands that
manage files; it never shows a file list on its own. Ask for
`/subagents list` when you want that list.

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

## Agent teams

An agent team is this session and its subagents. The Pi session is the **lead**;
there is no separate lead agent to start. The lead launches work with
`AgentTeam { action: "start", prompt, roster? }`, or you can enable a manual
board from the AGENT TEAM tab, `t`, or:

```text
/subagents agent-teams on
```

Now the lead creates tasks on a shared board, delegates with the ordinary
`Task` tool, and every new leg joins the agent team under a unique name
(`worker`, `worker-2`, ...). The child session gets `AgentTeam` and
`AgentTeamMessage` plus a short coordination block in its prompt. Simple one-job
runs stay outside the agent team.

Workflow:

1. Lead: `AgentTeam { action: "create", subject, description, write_scopes? }`.
2. Lead: `Task { subagent_type, description, prompt, run_in_background: true }`.
3. Teammate: `AgentTeam { action: "list", ready: true }`, then
   `AgentTeam { action: "claim", task_id, expected_revision }`.
4. Teammate does the work. To hand a fact to another teammate:
   `AgentTeamMessage { action: "send", to: "worker-2", text }`. A live member
   gets it on its next turn; a known finished member gets a bounded session
   queue. To wait for a named run: `AgentTeamMessage { action: "wait", to: "worker-2" }`
   (120s cap). A finished member's last run still answers if its row remains.
5. Teammate completes:
   `AgentTeam { action: "complete", task_id, expected_revision, result? }`.
   The result is trimmed and capped at 2,000 characters; the board keeps
   it and the detail pane shows it. A leg started by
   `AgentTeam { action: "start" }` also links its run, so `o` opens that
   transcript from the AGENT TEAM tab.
6. Lead reads the board (`/subagents agent-teams` or
   `AgentTeam { action: "status" }`) and waits for the settle cards, or calls
   `AgentTeamMessage { action: "wait", to }` for a named run.

When team mode is on, every work leg gets a board task automatically. The
parent creates it before the child starts, assigns the member, links the run,
and puts the task id in the child prompt. This covers `Task`, parallel, chain,
`/delegate`, and `finish`; `AgentTeam { action: "start" }` creates its tasks
once and reuses them. If the prompt already names a task (`task-1`), the parent
reuses that task instead of making a second one. The parent completes the task
from the report if the child forgot. Verifier and advisor runs never get a work
task.

Set `acceptance` on a task to gate completion. `complete` then moves it to
`in_review`; a fresh read-only verifier checks the result, the changed files,
and the commands. The verifier defaults to `code-reviewer`; set `verify_with`
to `tester` or another name. It is told to attack the result: try to break it,
name the first failing step, and pass only when the acceptance text is met by
evidence it checked. A `pass` makes the task `completed`; a `fail` returns it
to `pending` with the reason in `last_error`, so dependents stay blocked. A
verifier error leaves the task in review. Only the verifier or the lead can
verify; a lead override needs a note and is journaled. If team mode is off, no
verifier starts: the task stays in review and the lead can record its verdict
with `v`.

Set `cross_verify: true` on a task to add a second, independent reader after
the task verifier passes. The task stays in `in_review`; the cross reader
sees the other in-review rows from the same round and gets `scope: "cross"`.
Its pass is a second opinion, never a claim of correctness, and only then does
the task complete. Its fail returns the task to pending with the reason. An
opt-in needs `acceptance`; the gate is the task pass and, if opted in, the
cross pass.

A verify can keep one checked `fact` on a pass, or one `excluded` dead end on
a fail (500 characters each). Facts and dead ends form a team ledger: new work
legs get the newest facts and dead ends in their prompt, so the team reuses
what was proven and avoids repeating a known dead end. The ledger is capped at
50 facts and 20 dead ends; the oldest row of that kind drops out. The project
workspace ledger `agent-team-ledger.json` sits beside the state file and
survives new sessions and restarts for the same workspace: it keeps 20
workspaces, each with the same 50/20 caps, and merges those rows into the
newest team's ledger on restore. It is local only, mode 0600, and keyed by the
workspace hash. A corrupt file is ignored and reported once. The board
keeps the newest five attempts per task: release, verify fail, and verify pass,
each with the owner and the error. Duplicate facts are ignored.

Open a numbered round with `AgentTeam { action: "round", prompt, roster?, directions?, budget_tokens?, budget_minutes?, brief?, force? }`.
A round takes at most 12 legs and stores one prompt, the task ids, the shared
brief, and its budget. The default budget is 500,000 tokens and 30 minutes;
the hard ceilings are 5,000,000 tokens and 6 hours. A round is refused while
the previous round is still spending beyond its budget; `force: true` skips
only that previous-round check, never a hard ceiling, and is journaled. The
lead still decides every round; there is no separate orchestrator.

Ask for a round brief without giving up ownership:
`AgentTeam { action: "brief", question }`. It starts one read-only advisor
or planner run with the board snapshot, waits up to 120 seconds, and returns
text capped at 2,000 characters. Use it to sharpen a shared brief before
opening a round.

Ask for a second opinion without giving up ownership:
`AgentTeam { action: "advise", question, task_id? }`. It starts one bounded,
read-only `advisor` run (fallback `planner`) with the board and task snapshot,
waits up to 120 seconds, and returns the advice to the caller. Advice is not
stored on the board, cannot claim or edit a task, and cannot veto. One advice
runs at a time per team and shares the live cap.

Every mutation carries the revision it read. A stale revision on an
intent-only action (claim, release, complete, reopen, reassign, delete)
retries once and says `retried from rev N`. `edit` never retries because
it carries a whole new value, so read again first. Blockers live in
`edit` (`blocked_by`), must name existing tasks, and stay acyclic. Only
the lead reassigns, to `lead` or a known teammate; the owner or the lead
edits, completes, reopens, releases, or deletes.

A task that still blocks another cannot be deleted until that
dependency is cleared, so no live task is left waiting on a tombstone.

`write_scopes` are workspace-relative prefixes. While a task is in
progress it reserves those paths on the board: a claim, a reassign, or
an in-progress scope edit that overlaps another in-progress task is
refused and names the blocker. Pending and completed tasks reserve
nothing, and a task with no scopes locks nothing. On a refusal the lead
can run `AgentTeam { action: "resolve", task_id }`. It is read-only: it names
each blocker, owner, revision, scope, and whether the owner is live, then
suggests a release or a narrower scope. The lead still makes the change.
This is a board reservation, not a filesystem sandbox: files are shared
unless you opt into a worktree, `bash` can still write anywhere, and the
lead reviews the diff.

If a leg fails or is stopped, its claimed tasks go back to pending with
a new revision, and the settle card names them. The task remembers
`last_owner`, `last_error`, and `returned_at`, so the next claim shows
`last worker: boom` and knows what failed. It also keeps the newest five
attempts (release, verify fail, verify pass) with the owner and error, so a
task that keeps coming back shows its history instead of one line. A restart
releases every in_progress task with `Pi restarted`.

Task changes never start an agent. A ready task wakes nobody; the lead
delegates, and a finished leg still wakes the lead with its report. Use
`TaskOutput` for the report, or `TaskControl` to steer/stop/retry.

For broad independent fan-out, the lead calls
`AgentTeam { action: "start", prompt, roster? }`, or you can use
`/subagents agent-teams <prompt>`. It creates one board task and one worker per leg,
turns agent team mode on if it was off, and reuses the live-cap queue. Each task
inherits its subagent's `paths` as `write_scopes`; a leg without `paths` is
unscoped, and the report warns that parallel edits can collide. A stopped
run leaves queued tasks pending; delete them in the AGENT TEAM tab.

Add `isolation: "worktree"` to `start`, `round`, `create`, or `edit`
(create/edit only while pending) to give each leg its own detached git
worktree under `<tmp>/pi-subagents-worktrees/<workspace-hash>/<task-id>`.
The leg prompt names the path and says to commit there; the lead merges. A
non-git workspace is refused and its tasks are rolled back. Manage one with
`AgentTeam { action: "worktree", task_id, worktree_action: "status" | "merged" | "remove" }`,
lead-only. `merged` removes only a clean worktree and records `merged_at`;
`remove` forces. A dirty worktree is never deleted implicitly.

The board lives in the same per-session state file as runs, so
`/reload` keeps tasks, revisions, owners, and member names.
`/subagents agent-teams off` keeps the board and lets a claimed task finish; it
only stops new legs from joining. A new Pi session starts with an empty board;
the workspace ledger still loads for the same workspace. Limits: 128 live tasks,
128 rows per list, 2,000 characters per description, 500 per acceptance,
500 per fact or dead end, 50 facts and 20 dead ends per team, 300 per note,
64 per verifier name, 1,000 per advice question, 20 blockers and 20 scopes
per task, five attempts per task, 32 members, 5 rounds per team, 12 legs per
round, 2,000 characters per brief, 4,000 per promoted draft, and 512 per
worktree path. Round budgets default to 500,000 tokens / 30 minutes and are
hard-capped at 5,000,000 / 6 hours; the workspace ledger keeps 20 workspaces. Idle members are evicted; a 33rd join is
refused when all 32 own live tasks, and a start takes at most 32 legs.

While agent team mode is on, the lead's system prompt gets a short policy
section: plan, create tasks, split write scopes, delegate, then wait.
Only the lead spawns; an agent teammate cannot delegate further.

In the AGENT TEAM tab, a task waiting for a verdict shows `?` and the header
counts `N review` and `N facts`. `v` records a pass or fail: the lead's
reason is journaled, and an optional fact or dead end is kept. `i` asks the
advisor. The detail pane shows the acceptance text, the verifier run, the
verdict, the cross verdict, the round, the worktree, and the two newest
attempts.

Promote a finished task into a starter draft with
`AgentTeam { action: "promote", task_id, confirm? }` (lead-only). It needs a
completed task, a passing task verdict, and a cross pass when opted in. The
default is a preview; `confirm: true` writes to
`<agent-dir>/subagents/drafts/<name>.md`. A draft never overwrites: it gets a
`-2` suffix. Drafts are not discovered as active subagents, and the draft
uses read-only tools by default.

When a run fails, the task detail notice appends a short why view: status,
failure family, failing chain step, turns, tokens, the last five tools, the
last error, and the report head. The finish hook payload also carries a
`report` field, capped at 2,000 characters, for foreground, background,
resume, and chain runs.

`node tools/roster-bench.mts [journal] [--json]` reads the local journal and
prints the context curve by turn bucket, handoff tax (next prompt versus prior
report), success by roster size, and the smallest roster within 10% of the
best. It is a local measurement, not a CI gate. On 2026-11-26 the local journal held
no runs in this environment, so no number is reported.

`AgentTeamMessage` sends to a live member first. A known finished member gets
a bounded session queue (8 messages or 8,000 characters): the send result
says `queued`, and the queue flushes when that member rejoins or is
retried. The queue is saved with the agent team board, so `/reload` keeps it; a member
that never rejoins never reads it. A chain member can receive a message
but cannot be waited on, because a chain has no per-step run row.
Messages are capped at 2,000 characters; the journal records `from`,
`to`, `chars`, and whether it was queued, never the text.

This follows DeepSeek Harness agent teams: teammates are ordinary
subagents, the board is the coordination channel, and ownership grants no
filesystem lock. The bounded peer queue, named wait, and read-only scope
resolver are the small port of its peer messaging and conflict handling.

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

Background: add `run_in_background: true`. Task returns a `task_id`, and
the parent can end its turn: when the leg settles, the pack posts one
steer message (task id, subagent, status, time, turns, tokens, cost,
report) that starts a new parent turn. Do not poll in a wait loop; use
`TaskOutput` for an explicit check or a failure label. Turn the wake off
with `settleNotify: false`. Full text comes once on the first done poll;
later polls say done short. Max `liveCap` live tasks (default 12; fan-out
legs share this cap, and a larger fan-out is refused, so split it into
batches).

A transient provider failure (408, 429, 5xx, timeout, reset) retries the
same task twice, after 1 s and 4 s with ±25% jitter; `Retry-After` and a
shared 429 cooldown can lengthen the wait, capped at 30 s. The journal
records `retry` with `delayMs` and `reason`. A third failure ends the task
`error` and the wake message carries the error.

`TaskControl` acts on a live or errored task: `action: "steer"` with
`text` reaches the child before its next request, `action: "stop"` stops
it, and `action: "retry"` relaunches an errored background task with the
same prompt and a new `task_id`. Stopping a chain cuts the running step,
keeps the chain row as `error`, and leaves every later step `pending`.

Resume: pass `resume: task_id` plus a new `prompt` with the same
`subagent_type`. The follow-up run keeps prior history. A done or stopped
task resumes after a Pi restart: its row and history persist on disk. A
stop keeps the row as `stopped`, so `TaskOutput` names the reason and the
same id resumes with the transcript it kept. One resume makes one
follow-up row; the original keeps its id. The child gets a bounded,
readable transcript of the old run (newest entries kept, older ones
counted), never a raw history dump.

Return contract: pass `return: ["files", "risks"]` to make the report end
with one line per field (`files: …`, `risks: …`). Only the last contiguous
block of `Field: value` lines counts: a bullet, a bold label, `=`, an
empty value, or prose after the block does not. The result flags missing
fields as `[return] missing: …`, `details.missing` lists the same names,
and the run is labeled `verification` (a fact, not a guess). It is a
presence check, not a quality check. Single task, background, and resume take a
contract; `chain` and `parallel` refuse it because each leg has its own
needs. Limits: 8 fields, 40 chars each, duplicates drop.

Finish hook: set `finishHook` to a command in settings. Each finished leg
sends one JSON line on stdin and the command's output is ignored:

[Showing lines 1-635 of 643 (50.0KB limit). Use offset=636 to continue.]
