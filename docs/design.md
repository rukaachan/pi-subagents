# Design

pi-subagents gives Pi a small set of composable workers. A worker is a
Markdown file, a run is a fresh context, and the parent decides when to
delegate. The design keeps that decision visible; there is no hidden
router.

## Goals

- Make one worker easy to start and easy to inspect.
- Make parallel work safe by default.
- Keep the parent in charge of the goal.
- Keep state small enough to read and portable enough to resume.
- Let advanced work (teams, rounds, verification) grow without making
  the common path heavier.

## Layers

Dependencies point inward:

```text
extensions/          entry point
  src/tools/         model-facing tools
  src/ui/            commands, menus, board, viewer
  src/app/           use-cases and orchestration
  src/infra/         host, files, state, worktrees, MCP
  src/telemetry/     journal, live tracking, notifications
  src/domain/        pure types, rules, transitions
```

`extensions/index.ts` wires the pieces. It registers `Task`, the
`subagent` alias, `TaskControl`, `TaskOutput`, `AgentTeam`,
`AgentTeamMessage`, `/delegate`, and `/subagents`. It does not own the
run loop or the rendering.

The dependency guard checks:

- no source module imports `extensions/`;
- no import cycles among source modules;
- no layer imports a layer above it;
- the domain layer reads no `process.env` and imports no host, disk, or
  provider code;
- cross-folder imports go through the target folder's `index.ts`;
- every source folder has an entry file;
- no folder holds more than seven sources.

There is no file line limit. A file may grow when its job is still one
job; split it when the job or the dependency direction changes.

## Domain

The domain layer owns the rules that do not need a machine:

- subagent frontmatter and tool policy;
- task status and transitions;
- roster matching and delegation policy;
- agent-team board transitions, revision checks, and gates;
- round budgets and refusal rules;
- pure report formatting and roster summaries.

It does not read the disk or environment and imports no host or provider
code. Those enter through ports implemented in `infra` and wired in
`app`.

## Application

`src/app` contains use-cases:

- launch a task, fan-out, chain, or delegate;
- run a child and settle its result;
- persist and restore state;
- merge the workspace ledger;
- start, round, verify, advise, brief, isolate, or promote team work;
- stop and retry runs.

An app module may import domain, infra, telemetry, and app. It must not
import UI or tools.

## Infra and telemetry

`src/infra` holds the host boundary:

- child sessions and tool setup;
- subagent file discovery and editing;
- project state and the workspace ledger;
- git worktrees;
- MCP setup;
- tool guards.

`src/telemetry` holds observation, not control: the append-only journal,
live run tracking, footer progress, finish cards, and the optional finish
hook. Telemetry failures never decide a run's outcome.

## UI and tools

`src/tools` adapts app use-cases to model tools. `src/ui` adapts them to
commands and terminal views. Both are delivery layers: they may read the
lower layers, but the lower layers never import them.

The UI has two main surfaces:

- **menus** for picking a subagent, editing a file, and reading a detail;
- **mission control** for the Runs and Team tabs, with a read-only
  transcript viewer.

The board and viewer receive data through small interfaces. They do not
launch runs or mutate files directly; an action goes back to the app.

## Contracts

The public tool surface is intentionally narrow:

- `Task` — one run, a parallel group, a chain, or a temp definition.
- `TaskControl` — steer, stop, or retry.
- `TaskOutput` — read a task's report or mark a failure.
- `AgentTeam` — one board action at a time.
- `AgentTeamMessage` — send or wait for a teammate.
- `/subagents` — the human command surface.
- `/delegate` — the two-leg explorer + worker shortcut.

A board mutation carries `expected_revision`. A stale write fails with
the current revision rather than overwriting a newer one. A task id is
stable; a run id groups the legs that came from one launch.

## State

State is local and bounded:

- one state file per Pi session, keyed by workspace and session id;
- 20 recent done task records, each with capped history;
- one team board with at most 128 tasks;
- an optional workspace ledger for checked facts and dead ends;
- an append-only journal capped at 2 MB with one rotation.

The state file is written atomically. A corrupt or unknown field is
skipped, not allowed to take down the session. A run that was live when
Pi exited is frozen as an interrupted error on restore.

## Trade-offs

| Choice                        | Why                                                       | Cost                                                                     |
| ----------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| Markdown subagents            | Editable, diffable, reviewable without a build step.      | No compiled schema; validation is at load time.                          |
| Prompt policy, not a router   | The parent keeps the goal and chooses the ladder.         | The model must read the policy; a hidden router could be more automatic. |
| Fresh child context           | No parent transcript leak; smaller and cheaper prompts.   | The child must be given the task and the relevant paths.                 |
| Parallel legs with a live cap | Bounded resource use; queued work is not lost.            | A large fan-out waits.                                                   |
| Revise-and-check team state   | A stale board edit cannot silently overwrite a newer one. | Every mutation needs a revision.                                         |
| Local state only              | No server, account, or network dependency.                | State does not follow the user across machines.                          |
| Preview before promote        | A generated draft cannot overwrite a real subagent file.  | Promotion takes one extra confirmation.                                  |
| Explicit worktree cleanup     | A dirty worktree may hold uncommitted work.               | The lead must retire it when done.                                       |

## Limits

- Path-based local package install.
- No build step; Pi loads TypeScript through jiti.
- 12 live legs by default; `liveCap` accepts 1–64.
- 4 legs for the auto-picked finish roster.
- 128 board tasks; 5 rounds; 12 legs per round.
- Default run timeout 3,600 s when no budget is set.
- 2 MB state file, 2 MB journal, 60-message / 24,000-character history.
- One optional finish hook per finished run.

## Development

The guard is the architecture, not a line count:

```bash
npm run arch
npm run check
npm run e2e:fixtures
```

When adding a feature:

1. Put pure rules in `domain` and test them without the host.
2. Put I/O behind an `infra` port.
3. Wire the use-case in `app`.
4. Add the tool or UI adapter last.
5. Add a success test, a refusal test, and a restore test for every new
   persisted field or event.
