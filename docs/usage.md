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
This is a board reservation, not a filesystem sandbox: `bash` can still
write anywhere, files are shared, there is no worktree, and the lead
reviews the diff.

If a leg fails or is stopped, its claimed tasks go back to pending with
a new revision, and the settle card names them. The task remembers
`last_owner`, `last_error`, and `returned_at`, so the next claim shows
`last worker: boom` and knows what failed. A done leg that forgot to
complete its task keeps it; the card says which task is still open.
A restart releases every in_progress task with `Pi restarted`.

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

The board lives in the same per-session state file as runs, so
`/reload` keeps tasks, revisions, owners, and member names.
`/subagents agent-teams off` keeps the board and lets a claimed task finish; it
only stops new legs from joining. A new Pi session starts empty. Limits: 128 live tasks,
128 rows per list, 2,000 characters per description, 20 blockers and 20
scopes per task, and 32 members. Idle members are evicted; a 33rd join is
refused when all 32 own live tasks, and a start takes at most 32 legs.

While agent team mode is on, the lead's system prompt gets a short policy
section: plan, create tasks, split write scopes, delegate, then wait.
Only the lead spawns; an agent teammate cannot delegate further.

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

```json
{
	"event": "subagent_end",
	"task_id": "task-abc-1",
	"subagent": "explorer",
	"status": "done",
	"ms": 1651,
	"chars": 560,
	"model": "acme/fast",
	"cwd": "/repo"
}
```

`status` is `done`, `error`, or `interrupted`; `error` appears only on a
failure. A hook that runs past 5 s is killed with `SIGKILL`, and a hook
that exits non-zero changes nothing. User settings always apply; a project
`.pi/settings.json` only when the folder is trusted; agent files cannot set
it. Example: `"finishHook": "jq -c '{leg:.subagent, ok:(.status==\"done\"), ms}' >> ~/legs.ndjson"`.

Failure label: after a task fails, the caller may record why once:
`TaskOutput(task_id, failure: "spec" | "coordination" | "verification")`.
It never guesses and accepts no other value; a second label is refused and
the first is kept. A running task is refused too. The label lands in the
journal as one `failure` event and shows as `[spec]` in `/delegate reports`.

Per-run switches on `Task` and the `subagent` alias: `model`, `budget`,
`codemode` (`off`, `on`, `only`, or `true`/`false`), and `complexity`.
They apply to single runs, fan-out legs, chain steps, and resumes; they
change that call only, and the file on disk is untouched. They sit at the
top of the precedence chain described above; the settings block is next.

## Tool paint

- Task result: `✓ Task` + turns, tokens, cost; fail shows `✗` + short cause.
- TaskOutput result: `…` + turns/s/tool while running, `✓` + use when done, `✗` on fail.
- Footer: `⇄ …` while a leg runs. A finished leg leaves `✓ name 2s`, `✗` on
  error, or `⊘` on a stop; the newest three stay for 8 s, then drop. More
  than three shows `+N`. A stop-all clears older `✓` tokens first.

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
first error; later steps stay `pending`. Stopping a live chain does the
same: the cut step is `error` and the rest stay `pending`. Poll a live chain with
`TaskOutput` to see the step strip: `explorer ✓ → worker … → reviewer ·`.
Chains restart as a new Task — steps do not resume alone.

## Complexity and model (v0.8)

- `complexity`: `light` (low), `medium` (medium), `heavy` (high) sets
  the thinking tier for one run. An explicit `thinkingLevel` in the
  subagent file still wins.
- `model`: override the model for one run, e.g. `model: "acme/fast-1"`.
  The file on disk is never changed.

## Persistence (v0.8)

Tasks and spawn counts survive a reload, or a restart that continues
the same Pi session, at
`~/.pi/agent/pi-subagents-state/s-<hash>.json`, one file per Pi
session (atomic write, 2 MB cap measured in UTF-8 bytes, oldest rows drop
first; a larger file is ignored on read rather than parsed on the main thread). A brand-new
session starts with an empty board. The old per-project file is
imported once when a matching session row exists.
The board and `/subagents tasks` show only runs from the current
folder and the current Pi session, so old work from another repo
cannot leak in. Done rows in this session stay pollable; a done row
from this folder still resumes by id when it lives in an older
session's file, because the lookup scans the saved files for the
folder. Live rows cannot survive:
their child sessions are gone, so restore marks them `error —
interrupted by Pi restart`, freezes their clock, and drops the kept
history. A failed save reports `state save failed` once, journals
`state_error`, and leaves the run alive.

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
`researcher`) run with `read`, `grep`, `find`, `ls`, and `codemode`; the
clamp strips shell, edit, and write even if a list names them. `tester` and
`worker` use the `execute` group (with `codemode`). The explorer can no
longer run `git log` or `git grep`; use `grep`, `find`, `read`, and
codemode. `tests/prompts.test.ts` fails any read-only starter that carries
`bash`.

## Roadmap

- The parent's own confirmation rules inside child sessions. Pi's
  `tool_call` confirm hooks still do not run in a child, so a parent's
  "ask before rm -rf" never sees a child call. The package gate
  (`gates: on`) covers a fixed deny list instead; carrying a parent's
  arbitrary rules across the session boundary is not implemented.
- Import from Claude Code agents.
