# Budgets and guards

A budget is a ceiling, not a target. It stops a run that would otherwise
keep spending. A guard also stops a run that has gone silent.

## Where a budget comes from

Highest priority first:

1. a per-run `Task` budget;
2. the `pi-subagents` settings block;
3. the subagent file;
4. the built-in default.

`budget` merges key by key. A missing `timeoutSec` becomes 3,600 s, so
forgetting the field cannot create an unbounded run. An explicit
`budget: { }` means no spending caps.

## Fields

| Field            | Meaning                       | Off                                          |
| ---------------- | ----------------------------- | -------------------------------------------- |
| `timeoutSec`     | Wall clock for the whole run. | `0`; omit the field for the 3,600 s default. |
| `maxTurns`       | Assistant turns.              | `0`                                          |
| `maxInputTokens` | Summed prompt tokens.         | `0`                                          |
| `maxCost`        | Provider-reported cost.       | `0`                                          |
| `maxReportChars` | Returned report length.       | `0`                                          |

`maxCost` accepts a non-negative number; the currency is whatever the
provider reports. The other numeric fields require whole numbers.

Prompt tokens count `input + cacheRead + cacheWrite`. Counting only
`input` would miss the cached part of the prompt and let a run continue
well past its real spend.

## Starter budgets

The six shipped subagents use:

| Group                                  | Budget                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `worker`, `tester`, `researcher`       | `{ maxTurns: 0, maxInputTokens: 0, timeoutSec: 5400, maxReportChars: 6000 }` |
| `explorer`, `planner`, `code-reviewer` | `{ maxTurns: 0, maxInputTokens: 0, timeoutSec: 3600, maxReportChars: 6000 }` |

`maxTurns` and `maxInputTokens` are off in the starters. The timeout is
the bound that needs nothing from the provider; the token and turn caps
remain available for paid lanes.

## What a stop returns

A budget stop does not return an empty string. The report starts with a
marker and keeps the child's own words when it has them:

```text
[cut short] timeout 600s reached: the run was aborted after 600s.
```

```text
[cut short] input budget 120000 reached: run stopped after 138,135 prompt tokens (cached reads included).
```

A run that ends on a tool call gets:

```text
[incomplete] the run ended on a tool call; the text below is from an earlier turn.
```

A run that never spoke gets the marker plus its last steps. The caller
never receives old chatter as if it were the final answer.

When a provider reports zeros for usage, a token cap cannot fire. The run
note says so instead of looking budgeted.

## Timeout

The timeout starts when the run starts. It is checked at every turn
boundary as well as by its timer, so a late timer cannot extend the
deadline. A run with a timeout of at least 900 s gets a wind-down message
300 s before the deadline. The child is asked to stop opening new work and
report what it finished, what is unfinished, and the state needed to
resume.

If the child ignores the wind-down, the timeout still fires. The note
records both events.

## Stall watchdog

The timeout answers "how long may this run take". The stall watchdog
answers "is this run still alive". It is a 900 s gap with no session
event. Any streamed token, tool start, tool end, or turn re-arms it.

When it fires, the run is aborted and the report says:

```text
[cut short] stalled: no session event in 900s; the run was aborted at 1240s.
```

The stall floor is a system guard, not a budget knob. It holds even under
`budget: { }`, because "no caps" means no spending caps, not "let a dead
child hold the parent".

## Hard stop

Aborting a child is asynchronous. After a guard fires, the caller waits
10 s for a clean stop. If the child is still pending, its session is
disposed and the note says the run did not stop in time.

This bounds the waiter, not just the child. It prevents a dead socket
from holding the parent forever.

## Report cap

`maxReportChars` truncates the returned report and adds a marker with the
number of characters removed. The full report remains in the task record,
subject to the state cap.

## Team rounds

A team round has its own budget, separate from a child budget:

- default 500,000 tokens and 30 minutes;
- hard caps 5,000,000 tokens and 6 hours;
- one round stores the prompt, task ids, brief, budget, and start time.

Spend is the sum of input and output tokens from the round's tasks. Wall
time runs from the round start. `force` can open a round past the
previous round's budget, but not past the hard caps.

## Tuning

Start with the timeout. It is the only cap that works on free providers
that report no usage.

Add `maxInputTokens` when the provider bills by prompt size or when a
read loop can grow the context. Add `maxTurns` for a model that keeps
calling tools without progress. Add `maxCost` for a paid lane where a
fast loop can fit inside any timeout. Add `maxReportChars` when the
caller needs a bounded handoff.

Do not set a low turn cap just to make a run look cheap. A run that works
for 20 turns and returns nothing is worse than a longer run that reports
what it did.
