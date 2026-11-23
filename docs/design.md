# Design

## Layout

One package = one folder. The extension entry stays thin; logic lives in
`src/`, split by the job it does.

```text
pi-subagents/
├── package.json        # pi manifest: extensions entry + files
├── tsconfig.json
├── extensions/
│   └── index.ts        # wiring only: tools + commands
├── src/
│   ├── domain/         # pure rules and vocabulary. no fs, no host calls
│   │   ├── subagent/   #   config, budget, frontmatter, discovery, codemode,
│   │   │               #   contract, roster, paths
│   │   ├── task.ts     #   the row shape every layer names
│   │   ├── team.ts     #   the shared board: tasks, views, limits
│   │   ├── team-update.ts # compare-and-set transitions
│   │   ├── team-scope.ts  # write-scope reservations
│   │   ├── team-mail.ts   # live/cold message + wait graph
│   │   ├── team-sweep.ts  # free tasks a dead run still owned
│   │   ├── dispatch.ts #   nameless-dispatch rule table
│   │   ├── tiers.ts    #   complexity -> model and tool policy
│   │   ├── temp.ts     #   session-temp subagents
│   │   ├── run-result.ts  # usage, text, history of a finished run
│   │   └── run-report.ts  # the report a run hands back
│   ├── infra/          # adapters: disk and host
│   │   ├── files.ts, trash.ts, subagent-files.ts  # the .md files
│   │   ├── state-file.ts    # the state file format
│   │   ├── state-validate.ts, state-steps.ts  # validate disk records
│   │   ├── state-team.ts    # validate the persisted board
│   │   ├── team-tool.ts, team-tool-types.ts, team-tool-run.ts
│   │   ├── team-tool-schema.ts, team-render.ts
│   │   ├── team-message-tool.ts, team-message-schema.ts
│   │   └── host-session.ts, host-shim.ts, host-usage.ts
│   ├── telemetry/      # sinks: journal, progress, activity, per-run tracking
│   ├── app/            # orchestration: drivers, store, ledger, guards
│   │   ├── guards/     #   budget, wind-down, hard stop, install
│   │   ├── run.ts, background.ts, chain.ts, chain-task.ts, fanout.ts
│   │   ├── task-store.ts, task-record.ts, ledger.ts, persist.ts
│   │   ├── task-actions.ts, settle-notice.ts, background-attempt.ts
│   │   ├── team-store.ts, team-child.ts, team-policy.ts  # board + child join
│   │   ├── team-sweep.ts, team-mail.ts  # settle sweep + messages/wait graph
│   │   ├── team-launch.ts   # team start: one board task per worker
│   │   ├── finish.ts       # smallest matched roster, max 4
│   │   ├── hybrid-policy.ts # local -> Task -> delegate -> team start
│   │   └── steer-queue.ts, live-runs.ts, live-sessions.ts
│   ├── ui/             # presentation: picker, menu, rows, result shells
│   │   ├── command.ts      #   /subagents + list/new/tasks/trash/team/finish
│   │   ├── delegate-command.ts #   /delegate
│   │   ├── menu/workspace.ts, team-actions.ts # mission-control loop + board actions
│   │   └── view/       #   workspace, team, board, tabs, settled card, session view
│   └── tools/          # the tool definitions the host registers
│       └── task/       #   schema, pick, validate, execute
├── tests/              # one file per concern, all under 250 lines
└── subagents/          # starter subagents, copy to ~/.pi/agent/subagents/
```

### The rule: one file, one job, 250 lines

No file in `src/`, `extensions/`, or `tests/` is longer than 250 lines.
The limit is a guard, not a habit: `tests/architecture.test.ts` reads the
real tree and fails when a file crosses it. A file that grows past the
line splits — the same way a long function splits — into a module with
its own name.

The layers point inward, and the direction is checked, not trusted:

| layer         | may import                                |
| ------------- | ----------------------------------------- |
| `domain/`     | `domain/` — nothing else                  |
| `infra/`      | `domain/`, `infra/`                       |
| `telemetry/`  | `domain/`, `telemetry/`                   |
| `app/`        | `domain/`, `infra/`, `telemetry/`, `app/` |
| `ui/`         | the layers below it, plus `ui/`           |
| `tools/`      | everything below it                       |
| `extensions/` | `src/` — never the reverse                |

`domain/` may name a host _type_ (`import type`), because a type
vanishes at compile time. It may not import a host _value_ or `node:fs`:
the rules there run on plain data, so they stay testable without a
session and without a disk.

### Dependencies and public surface

The host stack is the only runtime dependency, and it is declared, not
bundled: `@earendil-works/pi-coding-agent`, `pi-agent-core`, `pi-ai`,
and `pi-tui` are optional peers with a deliberately open range (`*` —
this package tracks the host, which moves fast, and a local-path plugin
install never resolves peers anyway), so a plugin install never pulls a
second copy of the framework — two `Usage` types in one process is the
bug that shape produces. The tested host stays pinned where it is
enforced: `devDependencies` at exactly `1.4.0`, the version the gate
runs against (moved up from 1.3.0 for the codemode worker queue,
measured below). Every
host import is a root import; the single dynamic one (the codemode
factory) keeps pre-1.2 hosts green by never loading there.

The extension entry is wiring only. It used to be a 1,239-line file that
also owned the fan-out driver, the result rendering, and the whole
`/subagents` handler — every feature touched it, and a change to how a
result looks had to be read past chain scheduling. Then `src/` itself was
one flat folder of 20 files, and the biggest of them was 646 lines.
Both were split, with no logic change:

| folder                | files            | owns                                      |
| --------------------- | ---------------- | ----------------------------------------- |
| `extensions/index.ts` | 1 file, 27 lines | the three tool definitions and the wiring |
| `src/app/`            | 12 files         | drivers, store, ledger, guards            |
| `src/domain/`         | 11 files         | the rules and the vocabulary              |
| `src/infra/`          | 7 files          | disk and host adapters                    |
| `src/telemetry/`      | 4 files          | journal, progress, activity               |
| `src/ui/`             | 15 files         | picker, menu, rows, result shells         |
| `src/tools/`          | 8 files          | the tool definitions                      |

`runChainTask` and `runParallelTask` now take the `TaskStore` as a
parameter instead of reaching for a module-level singleton, which is
what made moving them possible: the dependency is visible at the call
site.

`tests/architecture.test.ts` holds the claims instead of trusting them:
no `src/` module may import `extensions/`, the entry may not own the
drivers, no import cycle may exist among `src/` modules, no layer may
import a layer above it, the domain layer may not reach the disk or the
host at runtime, and no file may cross 250 lines. Those checks found
real defects on their first runs: an import cycle
(`src/tasks.ts` imported `SubagentRunResult` from `src/runner.ts` while
`runner.ts` imported the store from `tasks.ts` — it erased at runtime, so
nothing failed, but the graph was wrong), two upward imports
(`infra/persist.ts` reached into `app/`, and `app/chain-task.ts` reached
into `ui/`), and a `domain/` module that read the disk.

There is no `exports` map: this package is installed by path and Pi reads
the directory in place, so there are no package consumers to fence off.
Inside the repo, tests and tools import `src/` by relative path. If a
name-based import is ever added, the map should expose only the entry
(`extensions/index.ts`), `./subagents/*.md`, and `package.json`.

## Mission control (v0.14)

The UI grew without adding a second source of truth: `TaskRecord` and
`TaskStore` stay the model, and every surface is a view of it.

- `src/ui/view/board-model.ts` is pure. The section comes from the row
  itself (`queued` has no `startedAt`; `running` has one and no
  `endedAt`; then `done`/`failed`), rows group by `runId` and sort by
  section, run, then age. `board-screen.ts` adds keys, paint, and a
  compact height, so a short list does not leave a blank screen.
  `board-detail.ts` fills the right side on wide terminals with the
  selected run, its status, and its cost. The split keeps every view
  file under 250 lines and lets the model be tested without a terminal.
- `src/app/task-actions.ts` owns steer, stop, and retry. `TaskControl`
  and the board keys both call it, so a key cannot drift from the tool.
- v4 keeps one `/subagents` surface: `workspace-screen.ts` inserts the
  RUNS | TEAM tab line above the existing board renderer, and
  `team-screen.ts` draws the board rows. `menu/workspace.ts` owns the
  modal loop; `team-actions.ts` owns create/edit/assign/claim/release/
  complete/delete/start/finish. Every mutation re-reads the revision;
  no edit is retried silently.
- `src/app/hybrid-policy.ts` is injected as
  `systemPromptOptions.sections.pi_subagents_hybrid` on every lead turn.
  It names the ladder; the model chooses. `Team { action: "start", prompt }`
  is lead-only and launches one worker per leg; it also turns team mode on.
  The UI `/subagents team on` is the enable-only path. Team start creates
  one board task per leg and reuses the `startLaunch` queue.
- Wake on settle is one message, once. `announceSettle` marks
  `fullDelivered` only when the sink accepted and reverts on failure; the
  report rides along unless `TaskOutput` already delivered it.
- `roster.ts` scores the shipped roster with the dispatch rule table plus
  name and description word overlap. A lone shared word is noise, so the
  floor is 3. `/subagents finish` prints every pick and the rule that chose
  it.
- `contract.ts` reads only the final contiguous `Field: value` block and
  returns `failure: "verification"` when a field is missing, so the label
  is a fact, not a model guess.
- Temp tools and `paths` narrow, never widen: `registerTemp` refuses a
  tool the caller cannot call, and `guardPaths` replaces `write`/`edit`
  in the child session. A fenced child loses `bash` and `powershell`,
  because a shell can write anywhere.

Measured (`npm run bench:finish`, 4000 calls over the six starters): a
roster pick is p50 38–82 µs and p95 73–110 µs across local runs, with 1.2
legs per prompt on average. The pick is noise beside session startup; the win is
that the operator types one command instead of naming every leg.

## Harness growth rule (after arxiv 2609.40303)

A new stage, subagent, field, or tool-policy knob must earn its seat:
name the defect in current runs, then show a before/after measurement
on the real pack (hit counts, coverage, or a falsifiable test).
Boundaries without evidence are rejected — minimal harnesses beat
elaborate ones at equal budget for strong backbones.

## Paper adoption

Prompt text is machinery too, and the same rule prices it. Their
judgment calls stay recorded so the next reader can dispute them.

| Paper                                  | Verdict          | Why                                                                                                                                                                                                                                                          |
| -------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2609.20812 OverclaimBench              | adopt            | NOT-READ/coverage line in every Report; incomplete reviews mislead 80% of the time.                                                                                                                                                                          |
| 2609.40303 Harness growth              | adopt            | The rule above: no seat without a named defect and a measurement.                                                                                                                                                                                            |
| 2606.14066 FastContext                 | adapt            | explorer batches independent searches, reads in parallel.                                                                                                                                                                                                    |
| 2608.09290 OpenCodeReview              | adapt            | code-reviewer falsifies its own findings before reporting.                                                                                                                                                                                                   |
| 2609.36730 LibraryDesignBench          | adopt            | worker reuses existing APIs before new ones; worker shows one call line for a new API; code-reviewer flags rigid or unexercised shapes; tester probes the caller's shape. Extra code comes from rigidity, not missing capability, and designs ship untested. |
| 2610.10263 concurrency catalog         | reject (for now) | 13 failure modes catalogued at unbounded concurrency; fan-out caps live legs (`liveCap`, default 12). Revisit if a mode reproduces in real logs.                                                                                                             |
| 2609.35659 Tracekit                    | reject (for now) | Hash-chained audit ledger proves the technique, but no tampering or corruption defect has been observed at our one state boundary.                                                                                                                           |
| 2610.00980 RAC                         | reject           | Runtime agent selection helps; their work-contract machinery lowered means under budget, single-seed evidence.                                                                                                                                               |
| nested Task                            | reject (for now) | Subagent sessions run with extensions off, so a nested Task tool cannot spawn. Designing for an unreachable state is pure cost.                                                                                                                              |
| 2610.06069 Attention/handoff           | adopt            | Delegation trades fresh-context accuracy against a per-boundary handoff tax; a contract and a verifier, not more legs.                                                                                                                                       |
| 2609.09233 Subagents vs skills         | adopt            | A separate context wins under overload only with clear input-output contracts; the child gets a bounded brief.                                                                                                                                               |
| 2605.08460 When child inherits         | adopt            | A child must not inherit raw parent memory; resume now passes a bounded transcript, not a sliced JSON dump.                                                                                                                                                  |
| 2510.12120 Protocol-driven             | adopt            | Return contract (`src/domain/subagent/contract.ts`): the report must name the fields the caller needs; under-specification is a design failure, not a model failure.                                                                                         |
| 2503.13657 MAST                        | adapt            | 14 modes in 3 families as a review checklist; a caller may now label one of the 3 families (`src/domain/failure.ts`), but nothing is inferred.                                                                                                               |
| 2606.31174 ClawArena-Team              | adapt            | The manager is the ceiling: least-privilege child, bounded context, bounded retry. Matches the tools clamp and the resume fix.                                                                                                                               |
| 2606.00655 Scaling inverted-U          | adapt            | Past a peak, more agents hurt; `liveCap` (default 12) stays a host guard, not an optimum, and no roster default changes without a defect.                                                                                                                    |
| 2505.23352 Topology                    | adapt            | Moderately sparse beats dense or minimal; our star and chain shapes already sit there, so no code.                                                                                                                                                           |
| 2402.05120 More agents                 | adapt            | Sampling and voting scale with count only for independent legs; fan-out already asks for independent targets.                                                                                                                                                |
| 2608.24271 Observability               | reject (for now) | Per-leg journal events cover the runs we have; no failure has needed spans beyond them.                                                                                                                                                                      |
| 2505.00212 Failure attribution         | reject (for now) | 53.5% agent and 14.2% step accuracy is too weak to automate; keep the step trail in the journal.                                                                                                                                                             |
| 2603.18000 AgentFactory                | reject (for now) | Executable subagent accumulation adds a code-generation surface with no repeated-task defect measured.                                                                                                                                                       |
| 2510.02669 AutoMaAS                    | reject (for now) | Architecture search optimises a roster already capped; no evidence our shape is wrong.                                                                                                                                                                       |
| Claude SubagentStop / Codex /subagents | adopt            | A finished leg needs a visible signal: the footer keeps `✓`, `✗`, or `⊘` for 8 s, newest three plus `+N`, and an optional `finishHook` command gets one JSON line. User settings or a trusted project only (research/claude-code-hooks.txt).                 |
| Claude agent teams                     | adapt            | v0.15 kept the parent as messenger; Team v2 adds a bounded peer channel and named wait; Team v3 adds a session cold queue and a read-only scope resolver, still with no cold resume or persisted mail.                                                       |
| DeepSeek agent teams                   | adapt            | The lead is the root session, not a new agent; teammates are ordinary legs. CAS board, scope reservations, peer messages, named wait, and a read-only conflict resolver. `research/deepseek-agent-teams.md`.                                                 |
| Codex [agents] live cap                | adopt            | `max_concurrent_threads_per_session` is configurable there; `liveCap` now matches it (1–64, default 12), and the codemode pool follows at load.                                                                                                              |

## Adopted from the 2026 corpus

The full texts sit in the local `research/` corpus, which is not shipped;
the arXiv ids above are stable. Add a row here before adding a field, and
follow the harness rule: name the defect, then measure.

The first adoption is the resume handoff (`src/app/resume-context.ts`).
Old code sent `JSON.stringify(history).slice(0, 20_000)`: 9 of 26 saved
runs crossed the slice and every one of those prompts ended mid-JSON, so
the child read a broken object. The new context shapes the history into
labelled entries, keeps the newest whole entries under the same 20k
budget, counts the hidden ones, and marks failed tool results. On the same
26 runs the context fell from 22k-43k chars of JSON to 6k-15k chars of
readable text, with no truncated entry (2605.08460, 2609.09233).

The second adoption is the finish signal. Old `FooterProgress.finish()`
deleted the entry, so a finished leg simply vanished and the caller had to
poll. The footer now keeps a per-leg token for 8 s (`✓` done, `✗` error,
`⊘` stopped), shows the newest three and `+N`, and clips at 64 columns. A
six-leg team start capture showed `✓ tester 2s · ⇄ 5 live · …` while the rest
ran, then `✓ planner 3s · ✓ explorer 3s +4`; the count dropped as tokens
aged out. `finish` is idempotent and the prune timer is unref'd, so a
finished run never holds the process open (research/claude-code-hooks.txt).

The third adoption is the return contract. A report could arrive short and
nothing said so. `Task` now takes `return: [...]`, appends one line per
field to the prompt, and flags any field missing from the report. It is a
presence check, not a quality check. There is no before number: no
contract existed to measure. The guard is 20 unit tests plus one real-child
test (`PI_IT_CONTRACT=1`, 5.4 s) asserting the fields reach the child's
prompt (2510.12120).

The fourth adoption is the finish hook. A finished leg used to be visible
only in the TUI footer. `finishHook` now spawns one shell command per leg
with a single JSON line (`event`, `task_id`, `subagent`, `status`, `ms`,
`chars`, `model`, `cwd`, `error?`). It is read from user settings always and
from project settings only when the folder is trusted; no agent file can
set it. Measured: the runner's blank-command guard costs 0.015 µs, a real spawn of `true`
is 1.0–1.1 ms at p50 / 3.8–4.9 ms at p95, and a hook past 5 s is killed with
`SIGKILL`. One real run (`PI_IT_HOOK=1`, 4.0 s) wrote exactly one line with
the right task id, status, cwd, and size (research/claude-code-hooks.txt).

The fifth adoption is the failure family. MAST's three families are now a
label the caller can attach once to a failed run:
`TaskOutput(task_id, failure: "spec" | "coordination" | "verification")`.
Nothing infers it, a second label is refused, and the journal stores one
`failure` event; `/delegate reports` shows `[spec]`. An append costs
6.5–7.2 µs.
This is the checklist from MAST made explicit, not an automated classifier:
step attribution is still too weak to trust (2503.13657, 2505.00212).

The sixth adoption is `liveCap`. The 12-leg ceiling was duplicated in the
scheduler, the error text, and the codemode default. Settings now accept
1–64, each run resolves it once, and the codemode pool follows at load.
A six-leg team start with `liveCap: 2` printed `2 started · 4 queued`, drained
in order, and wrote six hook lines. Nothing here is 100x: the live cap is
one settings read (0.11–0.12 ms, 4–5 ns after resolution) and the hot path is
unchanged (paint 0.34 ms, shape 0.40 ms, save 0.03 ms in `bench:layers`).

The corpus itself is local and unshipped. `research/index.md` maps the 32
papers; `research/notes.md` is the synthesis. Four vendor notes sit beside
them: `codex-subagents.txt`, `claude-code-subagents.txt`,
`claude-code-hooks.txt`, and `harness-comparison.txt`.
