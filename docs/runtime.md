# Runtime

This is the technical view of what pi-subagents does between a prompt and
a report. The short version: one extension entry point wires tools,
commands, state, and telemetry; each run gets an in-memory child session;
the result is journaled and saved.

## Where the pieces live

Layers point inward:

```text
extensions/         entry point: registers tools and commands
  src/ui/           menus, board, viewer, commands
  src/tools/        Task, TaskControl, TaskOutput, AgentTeam
  src/app/          use-cases: launch, run, team, persist, finish
  src/infra/        host session, files, state, worktrees, MCP
  src/telemetry/    journal, live tracking, notifications
  src/domain/       pure rules, types, state transitions
```

A layer may import the layers below it, never above it. Cross-folder
imports go through a folder's `index.ts`. The domain layer reads no
environment and imports no host, disk, or provider code. The full guard
lives in `tests/architecture.test.ts`.

## Run lifecycle

1. **Parse.** The tool or command resolves a subagent, a prompt, and
   optional per-run switches. Temp definitions are registered for this
   session only.
2. **Admit.** A live slot is reserved. The default cap is 12. Legs over
   the cap wait in the queue and start as slots free.
3. **Bind.** The child gets a fresh in-memory session, its model, clamped
   tools, optional paths fence, MCP servers, and project context.
4. **Run.** The child receives the prompt plus its `promptPrefix` and,
   under codemode, the script-route rule. Turns, tools, usage, and
   compaction are tracked.
5. **End.** The report is built from the real session. A limit stop,
   missing final answer, or thrown error gets a marker rather than a
   silent empty string.
6. **Save.** The task record is capped and written to project state. Live
   progress goes to the journal and the footer. The finish hook, when
   configured, runs once.

Foreground `Task` awaits the result. `run_in_background` returns the id
and wakes the parent when the leg settles. A resumed task starts a new
child from its saved prompt and history; the old record stays readable.

## Child context

Each child starts clean:

- It does not see the parent transcript.
- The subagent body is the system prompt.
- `promptPrefix` is fixed framing, not a per-task instruction.
- `context: true` loads `AGENTS.md` and project context files. The run
  note records the size.
- `tools` is clamped by autonomy and by `paths`. A paths fence also turns
  off shell tools because a shell can write outside the fence.
- MCP is opt-in. Servers are configured in `mcp.json`; OAuth sign-in
  happens in the parent. MCP tools are not path-fenced, so `paths` and
  MCP cannot be combined.
- `gates: true` installs the package's deny list. A child has no UI, so a
  blocked call is reported, never prompted.
- Compaction happens inside the child session. The journal records a
  `compact` event with token counts and whether the abort was requested.

## State

```text
~/.pi/agent/pi-subagents-state/s-<hash>.json
```

The hash is 16 hex characters of the workspace path and session id. One
file exists per Pi session, so two sessions in one workspace never
overwrite each other. Older builds used a project file:
`<sha1(cwd)[:12]>.json`. It is still read when a session file is absent.

The file is versioned, written atomically, and capped at 2 MB. It holds
the recent task records, spawn counts, and the team board. A record keeps
the newest 60 messages and 24,000 characters of history; a report is
capped at 60,000 characters. Rows from an older build are decoded with
defaults, not rejected.

A saved `running` row cannot still be live after a restart. It is frozen
as an error with an explicit "interrupted by restart" message. That
prevents a stale row from looking active forever.

The optional workspace ledger is separate:

```text
~/.pi/agent/pi-subagents-state/agent-team-ledger.json
```

It holds checked facts and dead ends per workspace, keyed by a short
hash of the workspace path. The file is local, permission `0600`, and
merged atomically. Foreign workspaces in the file are ignored.

## Journal

```text
~/.pi/agent/pi-subagents-journal.ndjson
```

Set `PI_SUBAGENTS_JOURNAL` to another path, or `off` to disable it.
The file rotates to `.1` at 2 MB. Each line is one event.

Run events: `run_start`, `turn`, `tool`, `failure`, `retry`,
`steer`, `stop`, `compact`, `run_end`.

Team and state events: `agent_team_message`, `agent_team_task`,
`agent_team_verify`, `agent_team_round`, `agent_team_brief`,
`agent_team_worktree`, `agent_team_promote`, `agent_team_advice`,
`state_error`.

`run_end` carries status, turns, elapsed seconds, report and prompt
sizes, input/output tokens, cost, model, notes, and the longest silence
(`gapMaxSec`, `gapOver60`). The task action event never records subject,
description, or result text.

The journal is for diagnosis and local reports. It is not a remote log.

## Agent team

The board is a shared task list with revisions. Every mutation checks the
expected revision, so a stale edit fails instead of overwriting a newer
change.

Statuses: `pending`, `in_progress`, `in_review`, `completed`. A task
that is `in_review` has a task-level pass but is not finished. It becomes
`completed` when the gate is satisfied. A failed verification sends it
back to `pending`.

A task has:

- subject and description;
- write scopes, used for overlap warnings;
- blockers, which keep a task from being ready;
- acceptance text, result, and attempts;
- an owner, the run that worked it, and its linked run id;
- optional round, isolation, and worktree fields.

The board holds at most 128 tasks. The UI starts and mutates tasks through
the same app layer as the `AgentTeam` tool. Write scopes are warnings,
not a lock; two tasks can reserve the same path and the board tells the
lead.

## Rounds

A round is one bounded fan-out from the board:

- at most 5 rounds per board;
- at most 12 legs per round;
- default budget 500,000 tokens and 30 minutes;
- hard caps 5,000,000 tokens and 6 hours.

Spend is the sum of input and output tokens reported by the round's
tasks. Wall time starts at the round's start. A later round can be forced
past the previous round's budget, but the hard caps still apply. The
round stores its prompt, task ids, optional brief, budget, and start time.

## Verification and advice

A task-level verifier is a separate read-only run. It receives the task,
the acceptance text, and the result. A pass leaves the task in
`in_review`; a fail returns it to `pending`. The verifier can be
overridden manually by the lead; the override is journaled and needs a
note.

Cross-verification is opt-in per task and requires acceptance text. It is
a second reader. A task pass alone is not
enough: the gate needs both passes. A cross failure returns the task to
`pending`. The wording is deliberate: this is a second opinion, not a
proof of correctness.

`advise` asks a read-only advisor for a second opinion. `brief` asks a
read-only advisor/planner for a short round brief before launch. The
brief is capped at 2,000 characters and has a 120 s timeout. A brief is
stored on the round and prepended to every leg prompt.

## Worktrees and promote

`isolation: "worktree"` creates a detached git worktree at the current
HEAD for each leg. Worktrees live under the system temp directory, keyed
by workspace and task id. A non-git workspace or a repository with no
commit is refused before any task is changed.

Worktree actions are lead-only:

- `status` reads the worktree state;
- `merged` removes a clean worktree and marks the task merged;
- `remove` force-removes it.

A dirty worktree is never removed automatically. The lead must keep it or
remove it explicitly. If a start fails after worktrees were created, the
rollback removes only the worktrees created by that start.

`promote` turns the last attempts of a completed task into a subagent
draft. It previews by default. `confirm: true` writes the file to
`~/.pi/agent/subagents/drafts/`. The roster never discovers drafts.
Existing files are never overwritten; a numeric suffix is used. The body
is capped at 4,000 characters.

## Concurrency, stop, and retry

The live cap covers foreground, background, delegate, finish, team, and
round legs. A waiting leg keeps its place in the queue. A stopped run
does not free its worktree; worktree cleanup is explicit.

Esc, `/reload`, and quitting Pi stop live children. The stop path is
sweep-owned: it stops every live run and leaves board tasks pending if
the run never produced a result. A retry starts a new attempt from the
saved prompt.

A guard fires in this order:

1. timeout or token/turn/cost budget;
2. stall watchdog after 900 s without a session event;
3. wind-down steer 300 s before a timeout of at least 900 s;
4. hard stop 10 s after the guard if the child does not settle.

The report says which one fired. The run stays resumable when the saved
history allows it.

## Failure and reporting

A child can fail at the provider, a tool, a guard, or the report step.
The record keeps the error and, when available, a failure family. The
report builder prefers the child's final words. If the child ended on a
tool call it adds `[incomplete]`; if a guard stopped it, it adds
`[cut short] <reason>`. A run that never spoke returns the marker plus
its last steps.

The board journal records the action and revision for team changes, not
the task text. The run journal records the report size, not the report
body. That keeps the log useful without copying private work.

## Provider and host edges

A provider 400 usually means the model or thinking level is not available
for that run. The error is returned with the child's notes; the parent
run is not retried automatically.

MCP startup can fail without failing the whole run; the run note says
which server failed. A missing tool in codemode returns a script error;
the next script can retry with a tool that exists.

The extension is loaded by Pi with jiti. There is no build output. State,
journal, and worktree paths are local to the machine.

## Developer checks

```bash
npm run check       # format, lint, typecheck, unit tests
npm run arch        # architecture guard
npm run e2e:fixtures
```

The architecture guard checks inward dependencies, no import cycles, an
entry file per source folder, cross-folder imports through entries, and
at most seven sources per folder. It does not impose a file line limit.
