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
Counts live past the 20-row prune and survive a reload, or a restart
that continues the same session.

## Footer progress

While a subagent runs, the Pi bottom bar shows one line per run:

`⇄ explorer · t3 · 12s · read`

Turns, elapsed, current tool — updated live. Two runs show both;
three or more collapse to `⇄ 3 live · …`. Done runs clear the bar.
Real percent is not shown: a run has no known total, so a % bar
would lie. Running `TaskOutput` polls carry the same snapshot
outside the TUI.

- Collapsed view cuts text; expand (`Ctrl+O`) shows full.

## Wake on settle

A background leg does not end silently. When it settles, `announceSettle`
sends one steer message with `customType: "pi-subagents:settled"` and
`triggerTurn: true`: task id, subagent, status, elapsed, turns, tokens,
cost, model, and the report when `TaskOutput` has not already delivered
it. The parent gets a new turn and can finish without polling. The rule
in `DELEGATION_RULE` says it in one line: when only waiting on delegated
results, end the turn.

The notice is sent once per run. `fullDelivered` is set only when the
sink accepted; if delivery throws, the flag goes back so a later poll can
still return the full text. A notice never throws into the run, is
skipped when the parent session changed, and is off with
`settleNotify: false`. Foreground runs and chains return inline, so they
never wake.

## Retry, steer, stop

A transient provider failure (408, 429, 5xx, timeout, reset) retries the
same task twice: attempts 1, 2, 3, waits of 1 s and 4 s with ±25% jitter,
and one `retry` journal event per retry with `delayMs` and `reason`.
`Retry-After` (seconds or an HTTP date) wins when it is longer; a 429 also
sets a per-model cooldown shared by sibling legs. Every delay is capped at
30 s, and a stop interrupts the wait in 100 ms slices. Anything else fails
at once. `TaskControl` retries an errored background task with a new id and
the saved prompt.

Steering reaches the child before its next request. If the child session
does not exist yet, the text waits in `steer-queue` (max 4 messages, 2000
chars) and lands when the session starts. `stop` aborts the run and
journals `{event: "stop", family: "coordination"}`; it is never labeled
`spec`. The board keys `s`, `x`, `r` call the same functions as the tool.

## Team board state

The team board is persisted with the rows, in the same per-session
`s-<hash>.json`: a `team` field with `teamId`, `enabled`, `nextId`,
tasks, and member names. A team change calls the same store touch as a
row change, so one debounced writer flushes both. `/reload` restores
the board before the first prompt; a new Pi session starts empty.

Reading is validated row by row (`src/infra/state-team.ts`): a bad
task id, revision, status, or timestamp drops that task, duplicate ids
drop, text is capped, and `nextId` is raised above the highest surviving
task so a new id can never collide. The last-attempt fields
(`lastOwner`, `lastError`, `returnedAt`) are validated too; a bad value
drops only that field. Deleted tasks stay as tombstones, so
a blocker reference still resolves; a task that still blocks a live task
cannot be deleted until that dependency is cleared. Caps: 128 live tasks,
32 members, 2,000-character descriptions, and 20 scopes or blockers per
task. Idle members are evicted; a 33rd join is refused when all 32 own live
tasks, and a start takes at most 32 legs. The Team list and TEAM tab show the
whole board, up to 128 tasks.

A member name is tied to the run that created it, so a retried
background leg rejoins as the same member and can finish the task it
claimed; a new run gets the next free name (`worker-2`).

A run that ends in error or is stopped releases the tasks it still owns:
they go back to pending with a new revision, and the settle notice names
them. The release records `lastOwner`, the reason (capped at 300
characters), and `returnedAt`, so the row shows `last worker: boom`.
A successful run that leaves a task in_progress keeps the claim, and the
notice says so. A restart releases every in_progress task with
`Pi restarted`, because no run survives it.

A claim, a reassign, or an in-progress scope edit checks the board for
another in-progress task whose scopes overlap. The update is refused
with the blocking task id, scope, and owner. Pending and completed tasks
reserve nothing; a task with no scopes locks nothing. This is a board
reservation, not a filesystem sandbox: `bash` still writes anywhere.

`Team { action: "resolve" }` is the read-only escape. It is lead-only,
takes `task_id`, and returns each blocker's revision, status, owner, and
reserved scope. `team-store.ts` computes the hits with `scopeConflicts`
and the tool adds `isLive` from `team-mail.ts`; the result suggests a
release when the owner is cold, or a narrower scope when it is live. It
never mutates, and it works while team mode is off.

`updateTeamTask` retries once when an intent-only action (claim,
release, complete, reopen, reassign, delete) arrives with a stale
revision; `edit` and `blocked_by` rewrites never retry because they
carry a whole new value. The result carries `retriedFrom`, and the tool
says `retried from rev N`.

The board does not start anyone. Restoring a pending task is history,
not a queue: no agent wakes because a task exists. The lead delegates
with `Task`, and the settle card still owns the wake.

`Team { action: "start", prompt, roster? }` is lead-only and always
launches. It handles the request before the active gate, validates the
prompt, then calls `startTeamLaunch` in `src/app/team-launch.ts`. That
function validates the roster and cap, turns team mode on if it was off,
creates one board task per leg (subject, full description, write scopes
from that subagent's `paths`), builds one child prompt naming the task id,
and calls `startLaunch(store, "team", names, prompt, ctx, { promptFor })`.
A leg without `paths` is unscoped; the report says parallel edits can
collide. The existing queue owns the live cap. If task creation fails
partway, the created tasks are deleted and a board that was off is turned
back off. A stopped run leaves queued tasks pending; delete them from the
TEAM tab. A child tool has no `launch` callback and returns a clear error.
The enable-only path is the UI switch (`/subagents team on`, `t`), which
calls the store directly without starting workers. The Team schema is
exercised with the local fake provider in e2e. `npm run smoke:live` is the
manual real-provider check (`PI_IT_LIVE=1` and `PI_IT_MODEL`); it never runs
in CI.

## Team tools and messages

`Team` and `TeamMessage` use one flat `Type.Object` each, with
`StringEnum` actions from `@earendil-works/pi-ai`. The Team action list
now begins `start`, `status`, `list`, `get`, `resolve`, ... and ends
`delete`; only `action` is required. `prompt` (required) and `roster`
(optional) are the fields for `start`. The flat shape avoids a top-level
`anyOf`; the handler checks the required field for the chosen action.
This is the provider-safe path, not a per-provider fallback.

`src/app/team-mail.ts` keeps a map of member name to run id and steer
function, bound after the child session starts and removed in the run's
`finally`. `send` steers a live child or calls the lead inbox set in
`extensions/index.ts`. A known cold member gets a session queue
(`MAX_COLD_MESSAGES = 8`, `MAX_COLD_CHARS = 8_000`), flushed by
`bindTeamMember`; a full queue is refused, never silently dropped. The
queue is saved with the board (`coldMail`) and restored before the first
prompt, so `/reload` keeps it; unknown members are dropped. A member that
never rejoins never reads it.

`wait` reads the shared task store and resolves on its next change,
capped at 120s. It tracks active wait edges in a `Set`; a new edge that
would close a cycle is refused before it subscribes, naming the chain.
Settle, timeout, or error deletes that exact edge. A known cold member
whose run row is settled still returns its report; a cold row still
marked running fails with `no live process`. A chain member is bound
without a run id and `wait` says why. The journal records
`team_message` with from/to/chars/queued, never the text. Messages are
capped at 2,000 characters.

Every board write also journals one `team_task` line:
`{ action, taskId, revision, actor, ok, error? }`. It never carries the
subject, description, or result text. A refused compare-and-set records
the revision the board is on, so a stale `expected_revision` is visible
without reading the board.

## MCP in child sessions

MCP is opt-in per subagent: `mcp: true` (or `on`) in the frontmatter, or the
`mcp` field in the editor. A child without it loads no MCP extension, so
existing agents pay nothing.

When it is on, `startSubagentSession` adds Pi's `createMcpExtension()` to the
loader factories and calls `session.bindExtensions({})`. That emits
`session_start`, which connects the servers from `mcp.json` in the agent
directory and the trusted project. Default exposure is `codemode`, so tools
do not clutter the model's declarations: a script calls
`tools.mcp__<server>__<tool>`. The parent can list and sign in to servers
with `/mcp`; a child cannot open a browser.

Costs and limits:

- One connection per live leg per server. A 12-leg team with one MCP server
  opens 12 child connections.
- `mcp` is refused below `medium`, with `codemode: off`, and with `paths`.
  MCP tools are not path-fenced, and the child's path guard does not inspect
  their arguments.
- Startup problems and connection errors go to `mcp.log` in the agent
  directory. A failed call rejects the script with the server's message.
- Pi's host confirm hooks still do not run in child sessions. `mcp: true` is
  only for servers you already trust; `gates: on` adds the package deny list
  described below.

The fake-provider e2e starts a real stdio MCP server
(`tests/fixtures/mcp-echo-server.mjs`), a real child session, and the real
codemode sandbox. It answers `MCP_PROVEN` only when the echoed `mcp-ok`
comes back through the tool result; otherwise it reports `MCP_MISSING`.

## Gates and context in child sessions

Both are opt-in per subagent and default off, so existing agents keep their
behavior.

`gates: on` adds one package-owned extension through the same
`extensionFactories` seam as MCP, bound by the same
`session.bindExtensions({})` call. A child binds no UI, so the gate **blocks
and never prompts**: `ctx.hasUI` is false and a confirm would hang the leg.

- Shell calls are checked against a fixed deny list: recursive `rm`, `sudo`,
  `mkfs`, `dd of=/dev/…`, `shutdown`/`reboot`, `chmod`/`chown … 777`,
  `git push --force`, `git reset --hard`, `git clean -fdx`, and writes to
  `/dev/sd*`.
- Every other tool is checked through `pi.getAllTools()`: a tool that declares
  `annotations.destructiveHint` is blocked, which covers destructive MCP tools.
- A call made from inside a codemode script reaches the same `tool_call`
  handler, so the dominant script path is covered. `tools/e2e/gate.test.ts`
  proves both the direct call and the nested one with the fake provider.
- A block writes `{ event: "gate", tool, reason }` to the journal and returns
  `gates: <what>. Narrow the task or turn gates off.`
- Below `medium` the field is refused: a read-only child has nothing to gate.
  It is allowed with `paths`.

`context: on` clears `noContextFiles` for that child, so Pi loads AGENTS.md
from the agent directory, the cwd, and its parents. After `loader.reload()`
the run reads `loader.getAgentsFiles()` and pushes one note — for example
`context: 1 file, 48 chars (AGENTS.md)` — so the text cost is visible before
the first turn. `tools/e2e/context.test.ts` writes a unique token into the
agent directory's AGENTS.md and asserts the token reaches the opting-in
child's system prompt and never the other child's.

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
- **A stopped row is removed, not finished.** The board and the project
  state file stop claiming a run that no
  longer exists. A stopped chain is the exception: it keeps its row as
  `error` so the cut step and the `pending` steps after it stay visible. A removed id is remembered (last 50), so
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
- State file: `~/.pi/agent/pi-subagents-state/s-<hash>.json`, one per
  Pi session (best-effort, atomic), so two sessions in one repo never
  overwrite each other. A matching row from the old per-project file is
  imported once; rows without a session id stay hidden. Set
  `PI_SUBAGENTS_STATE=<path>` to pin a file (used by the e2e tests).
- Resume by id falls back to a scan of the session files and the old
  per-project file for this folder, so a restart keeps resume. A row
  found there that was still `running` is frozen to `error` first.
- Delivered reports are capped at 40,000 characters. The state file
  keeps up to 60,000; anything larger is cut on save. State files are
  bounded at 2 MB of UTF-8 bytes; a larger file is ignored on read. A
  failed save (bad path, permission, disk full) reports `state save failed`
  once, journals `state_error`, and leaves the run alive.
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
