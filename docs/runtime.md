# Runtime

## Orphan rows in the watcher (v0.13.5)

A pi restart kills child sessions before their `finally` block
runs, so no `run_end` lands and the row reads as live work
forever. One real journal showed `30 live` when 5 were real.
`foldJournal` now ages a running row: no event for 15 minutes
means stale, not slow. The watcher prints `⊘`, labels the row
`stale 15m`, and separates the counts:

```
pi-subagents watch · 2 live · 41 total · 25 stale · <path>
```

The 15-minute line sits above the longest real turn gap in the
journal (3m41s) and below the shortest real run (2m), so a
working leg is never mislabelled.

## Spawn counts

Every spawn is counted: foreground, background, alias, chain.
Every run keeps a row — foreground, background, alias — with
a kind badge: `[fg]`, `[bg]`, `[alias]`. The Tasks picker title
shows live counts, e.g. `Tasks — spawned 5 · live: explorer×1`.
Foreground rows are resumable and pollable like background ones.
Counts live past the 20-row prune and persist across restarts.

## Footer progress

While a subagent runs, the Pi bottom bar shows one line per run:

`⇄ explorer · t3 · 12s · read`

Turns, elapsed, current tool — updated live. Two runs show both;
three or more collapse to `⇄ 3 live · …`. Done runs clear the bar.
Real percent is not shown: a run has no known total, so a % bar
would lie. Running `TaskOutput` polls carry the same snapshot
outside the TUI.

- Collapsed view cuts text; expand (`Ctrl+O`) shows full.

## Compaction

**A subagent compacts on its own, and the parent's compaction never
touches it.** Each subagent is its own pi session with its own
in-memory history, so the parent's `/compact` cannot shrink the child's
context and the child's compaction cannot shrink the parent's.

The rule inside the child is pi's own: the host summarizes the early
messages when the child's projected context crosses
`contextWindow - reserveTokens`, using the `compaction.*` settings from
`~/.pi/agent/settings.json` (the same file the parent reads).
`compaction.enabled: false` turns it off for the children too.

Measured live (`tools/compaction-probe.mts`, a child with a 30,000
token window, so the threshold sits at 13,616 tokens): the child
compacted **on its own** — `compaction_start:threshold` /
`compaction_end:threshold` inside the child's session — and the footer
noted it:

```
context compacted: 40198 tokens became 33835 tokens. The early messages are now a summary.
```

That note matters: after a compaction the child has a summary where its
earlier reads used to be, so a leg can forget what it found. The
journal carries a `compact` event, and the watcher marks the row
`!ctx1` (once per compaction).

What a compaction does **not** do: it does not touch the run's report,
the usage totals, or the budgets. `maxInputTokens` counts what the
provider was actually sent, so a compacted run still pays for the
tokens it used.

## Stop (Esc, reload, quit)

**Esc, reload, and quit mean the same thing: every live subagent stops
at once, and its row disappears.** Before this, pressing Esc only
stopped the parent turn. A fan-out had already returned its task ids,
so the legs kept reading files for minutes after the operator asked
them to stop — one journal row ran 11 minutes past the leg that
finished before it, and never wrote `run_end`.

The rule now:

| Trigger                         | What happens                                                             |
| ------------------------------- | ------------------------------------------------------------------------ |
| `Esc` (the `app.interrupt` key) | every live child session aborts and disposes; every row leaves the board |
| `reload`                        | same, before the new runtime starts                                      |
| `quit`                          | same, before the state file is written                                   |

**Esc cannot be bound.** Pi reserves `app.interrupt` in
`RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS`, so an extension shortcut
on that key is refused at load with `Extension shortcut 'escape' …
conflicts with built-in shortcut. Skipping.` — the first attempt did
exactly that. The watcher (`src/app/esc-watch.ts`) listens on
`ui.onTerminalInput` instead: that listener runs before the focused
component, so it sees the key, stops the runs, and **returns without
consuming it**, which leaves pi's own interrupt untouched. The host's
own `matchesKey(data, "escape")` does the matching, so `\x1b[A` (Up) and
`\x1bq` are not mistaken for a lone `\x1b`. An abort that arrives another
way is caught by `agent_settled { aborted: true }` and does the same.

**A dialog keeps the key.** Inside `/subagents` (the live board, the
file list, the wizard, a task detail) Esc means cancel, so the watcher
must stay out: `src/app/modal-depth.ts` counts the dialogs this package
opens, and every one of them runs inside `inModal(...)`. Without that,
one press did both things — cancelled the picker _and_ stopped the runs
the picker was showing. The counter falls in `finally`, so a dialog
that throws cannot leave the Esc stop switched off for good. Pi's own
dialogs (permission prompts, the model selector) cannot be counted:
the extension UI has no "is a dialog open" query. Press Esc twice
instead — once to close pi's dialog, once to stop the runs.

What "stop" means here:

- **No wind-down, no waiting.** A stop request books the stop, calls
  `abort()`, and calls `dispose()`. Measured on a live background run
  (`tools/stop-probe.mts`): **3 ms** from request to "nothing live".
- **The row is removed, not finished.** The board and
  `~/.pi/agent/pi-subagents-state.json` stop claiming a run that no
  longer exists. A removed id is remembered (last 50), so
  `TaskOutput` answers `Task "…" was stopped (Esc, reload, or quit) and
its row was removed.` instead of pretending it expired.
- **The ledger books a `stopped` run**, not a failure. `SpawnCounts`
  gained the field; old files without it read as `0`, and the picker
  title adds `· ⊘ n`.
- **The journal still records it**: `run_end { status: "interrupted" }`,
  and the watcher marks the row `⊘` with a `STOP …` cell.
- **Every live run is reached**: a foreground run, a parallel leg, a
  background row, a resume, and a chain step all register the same
  kind of stop closure, so one request covers them all. A chain's
  `run_in_background` step, which no signal could reach before, stops
  too — measured the same way (`tools/stop-chain-probe.mts`): live 1 →
  stopped in 4 ms, row gone, step journal `interrupted`, ledger
  `stopped: 1`.
- **The window before the child exists is covered.** `launchBackground`
  registers a placeholder before it awaits session creation, so a key
  press during those few hundred milliseconds still removes the row;
  the real session replaces the placeholder and is stopped before its
  first request.

What a stop does **not** do: it does not resume, and it keeps no
history for that row — the row is gone on purpose. A parent that dies
on its own (crash, `kill -9`, power) is a different case: those rows
are still restored as `error: Interrupted by Pi restart. History was
not saved.`

## Rules (v2)

- One return per run. No nested Task inside a subagent. No user ask.
- Child session: in-memory, no extensions, no skills, filtered tools, then disposed.
- Resume keeps the same subagent; a switch is a new task.
- Last 20 done tasks kept; older ids say expired.
- State file: `~/.pi/agent/pi-subagents-state.json` (best-effort, atomic).
- On block: the subagent reports back instead of prompting.

## When the provider answers 400

A run can end with a provider error instead of a report:

```
Error: opencode-zen-responses API error (400):
{"type":"invalid_request_error","message":"Upstream request failed:
 [invalid_request_error] request could not be processed"}
```

This comes from the provider, not from this pack. Measured on
2026-10-19, with the local bridge (`zen-bridge :4123`) and the real
tool schemas replayed:

- The failing sessions had **the parent session**, not a subagent, as
  the failing client. The error landed on the turn **after** an
  assistant message that made **two tool calls at once**.
- Replaying that exact payload — 17 real tools including `codemode` as
  a grammar tool, the two `function_call` items, `reasoning: max` —
  returned **200, 12 times out of 12**. So the payload alone is not the
  fault; the rejection is intermittent and upstream-side.
- The provider names no faulty field, so the bridge classifies the body
  as a _terse 400_ and replays it inside `ZEN_TERSE4XX_BUDGET_MS`
  (default 30000). One replay in that sequence recovered; the second
  was answered.

What to do: send the same message again. `retry.maxRetries` is 20, but
this error text matches neither the retryable nor the non-retryable
list in `@earendil-works/pi-ai`, so pi does not auto-retry it. A repeat
of the same turn succeeds in every measurement so far.

Check the real cause before blaming this pack:

```
journalctl --user -u zen-bridge --since "1 hour ago" | grep "400 body"
```

That line prints the upstream body. A body with `param: null` and no
field name is the terse case above; a body naming a field is a real
request fault and needs a fix here. Also confirm the input size:
`Your request resulted in more tokens than this model's maximum
context length` is context overflow, which compaction handles.
