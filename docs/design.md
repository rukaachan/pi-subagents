# Design

## Layout

One package = one folder. The extension entry stays thin; logic lives in
`src/`, split by the job it does.

```text
pi-subagents/
├── package.json        # pi manifest: extensions entry + files
├── tsconfig.json
├── extensions/
│   └── index.ts        # wiring only: three tools + the /subagents command
├── src/
│   ├── domain/         # pure rules and vocabulary. no fs, no host calls
│   │   ├── subagent/   #   config, budget, frontmatter, discovery, codemode
│   │   ├── task.ts     #   the row shape every layer names
│   │   ├── dispatch.ts #   nameless-dispatch rule table
│   │   ├── tiers.ts    #   complexity -> model and tool policy
│   │   ├── temp.ts     #   session-temp subagents
│   │   ├── run-result.ts  # usage, text, history of a finished run
│   │   └── run-report.ts  # the report a run hands back
│   ├── infra/          # adapters: disk and host
│   │   ├── files.ts, trash.ts, subagent-files.ts  # the .md files
│   │   ├── state-file.ts    # the state file format
│   │   └── host-session.ts, host-shim.ts, host-usage.ts
│   ├── telemetry/      # sinks: journal, progress, activity, per-run tracking
│   ├── app/            # orchestration: drivers, store, ledger, guards
│   │   ├── guards/     #   budget, wind-down, hard stop, install
│   │   ├── run.ts, background.ts, chain.ts, chain-task.ts, fanout.ts
│   │   └── task-store.ts, task-record.ts, ledger.ts, persist.ts
│   ├── ui/             # presentation: picker, menu, rows, result shells
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

## Harness growth rule (after arxiv 2609.40303)

A new stage, subagent, field, or tool-policy knob must earn its seat:
name the defect in current runs, then show a before/after measurement
on the real pack (hit counts, coverage, or a falsifiable test).
Boundaries without evidence are rejected — minimal harnesses beat
elaborate ones at equal budget for strong backbones.

## Paper adoption

Prompt text is machinery too, and the same rule prices it. Their
judgment calls stay recorded so the next reader can dispute them.

| Paper                          | Verdict          | Why                                                                                                                                                                                                                                                          |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2609.20812 OverclaimBench      | adopt            | NOT-READ/coverage line in every Report; incomplete reviews mislead 80% of the time.                                                                                                                                                                          |
| 2609.40303 Harness growth      | adopt            | The rule above: no seat without a named defect and a measurement.                                                                                                                                                                                            |
| 2606.14066 FastContext         | adapt            | explorer batches independent searches, reads in parallel.                                                                                                                                                                                                    |
| 2608.09290 OpenCodeReview      | adapt            | code-reviewer falsifies its own findings before reporting.                                                                                                                                                                                                   |
| 2609.36730 LibraryDesignBench  | adopt            | worker reuses existing APIs before new ones; worker shows one call line for a new API; code-reviewer flags rigid or unexercised shapes; tester probes the caller's shape. Extra code comes from rigidity, not missing capability, and designs ship untested. |
| 2610.10263 concurrency catalog | reject (for now) | 13 failure modes catalogued at unbounded concurrency; our fan-out caps live legs (raised 4 → 12 per user request). Revisit if a mode reproduces in real logs.                                                                                                |
| 2609.35659 Tracekit            | reject (for now) | Hash-chained audit ledger proves the technique, but no tampering or corruption defect has been observed at our one state boundary.                                                                                                                           |
| 2610.00980 RAC                 | reject           | Runtime agent selection helps; their work-contract machinery lowered means under budget, single-seed evidence.                                                                                                                                               |
| nested Task                    | reject (for now) | Subagent sessions run with extensions off, so a nested Task tool cannot spawn. Designing for an unreachable state is pure cost.                                                                                                                              |
