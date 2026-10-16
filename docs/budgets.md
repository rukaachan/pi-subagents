# Budgets and guards

## Budgets on every starter (v0.13.5)

The A/B showed the real cost driver is turns times context
growth, not the tool. Five starters shipped without a budget
(`budgetCapped: 0` in every census, because only explorer had
one and explorer batches), while five live `worker` legs ran 53
–69 turns for 285 tool calls — one tool per turn, 294 turns
total. Every starter now carries a ceiling:

| subagent                         | budget                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------- |
| worker, tester, researcher       | `{ maxTurns: 0, maxInputTokens: 0, timeoutSec: 5400, maxReportChars: 6000 }` |
| explorer, planner, code-reviewer | `{ maxTurns: 0, maxInputTokens: 0, timeoutSec: 3600, maxReportChars: 6000 }` |

`maxTurns` and `maxInputTokens` are **0 (off)** in every starter, and
`timeoutSec` carries the bound. These are free lanes: there is no
bill per turn to cap, and the free providers report no usage at all
(6,893 journal events read `usage in=0 out=0`, every one of them a
`*-free` model), so a token cap there is decorative. The failure mode
that actually costs is a run that never ends, and a wall clock bounds
that without asking the provider anything. Both caps remain in the
schema for paid lanes, where the bill is the risk a clock cannot see:
a fast expensive loop fits inside any timeout.

### Raised ceilings, and what a stopped run returns

The first ceilings were too low, and the real runs said so. Four
legs from one batch hit their line — worker 26/25, explorer 21/20,
code-reviewer 16/15 — and **all 31 capped runs in the journal came
back with an 11-character result**: `(no output)`. The runs had
worked for 26 turns and reported nothing, so the ceiling threw the
work away instead of bounding it.

Two changes:

1. **Ceilings raised, money line added.** Uncapped runs that finish
   damp at 18 turns median but the tail runs to 150, so 25 turns cut
   real work. `maxInputTokens` is now set in the starter files as
   the cost ceiling, because a turn cap alone cannot price a run.
   Measured over 1,482 recorded sessions, a cumulative prompt cap
   fires at:

   | prompt cap | fires in | median turn | used by                            |
   | ---------- | -------- | ----------- | ---------------------------------- |
   | 500k       | 26%      | 16          | planner, researcher, code-reviewer |
   | 600k       | 24%      | 18          | explorer                           |
   | 1.5M       | 19%      | 31          | worker, tester                     |

   So a cheap-context worker uses all 50 turns and a context-heavy one
   meets the token line near turn 31 — before the turn cap, which is
   the right order: tokens are the money.

2. **The first line of every report tells how the run ended.**
   `runReport` builds it from the session, so the marker is never a
   matter of the caller remembering to pass one. The rule, and the
   reason for it: a run that spends its last turns on tool calls has
   no closing message, and handing back turn-1 chatter as if it were
   the answer is silent corruption — a chain passes that string to the
   next leg, so a stalled run would look finished.

   | how the run ended          | what the caller gets                     |
   | -------------------------- | ---------------------------------------- |
   | closing message with words | those words, unchanged                   |
   | budget stopped it          | `[cut short] <note>`, then its own words |
   | ended on a tool call       | `[incomplete] …`, then its newest words  |
   | never spoke                | the marker, then the last steps          |

   The defect this fixes was live in the recorded data: the capped
   batch in the ledger had 26 assistant messages, exactly one with
   text (`I'll start by reading the target file and related modules.`),
   and the last message a tool call — so the report was that turn-1
   sentence, bare, with nothing to say the run had stalled.

   - live run, budget 3, task finished at the cap: 5,112 characters
     returned unchanged (measured against the old rule: same 5,112;
     wrapping a 6,086-character answer in a summary left 791, which
     is why the run's own words win)
   - live run, budget 1, cut before it spoke: 124 characters,
     `[cut short] turn budget 1 reached: run stopped after 2 turns.`
     plus `ls · internal/zen` and `find · internal/zen/**/*.go`
     instead of `(no output)`
   - recorded stalled shape replayed: `[incomplete] the run ended on a
tool call; the text below is from an earlier turn.` + the chatter,
     where the old rule returned the chatter alone

   One more gap closed on the way: a run that **threw** (provider
   death, tool crash) kept no history, so the only recovery was
   restarting from nothing. `recordFailure` now keeps the detached
   message copy alongside the error, which makes a failed run
   resumable through the same path as a stopped one. The error stays
   loud — status and message are unchanged.

A turn cap cannot see the other failure shape: the worst bare
A/B run was only 22 turns but spent **1.54M input**, because
every turn re-sent a growing history. `maxInputTokens` closes
that. Measured on a real session with a read loop that never
stops on its own (`maxTurns: 50, maxInputTokens: 120000`):

| arm              | turns | wall | input     | usd at 3/15 |
| ---------------- | ----- | ---- | --------- | ----------- |
| turn cap only    | 51    | 293s | 2,101,198 | $6.37       |
| turn + input cap | 14    | 30s  | 138,135   | $0.42       |

15× cheaper and 10× faster on the same runaway task, and the
note names the real total: `input budget 120000 reached: run
stopped after 138,135 prompt tokens (cached reads included).`

### The timeout is the guard now, and its numbers come from runs

Free lanes changed which cap is worth keeping. Two facts did it: no
bill accrues per turn, and the provider reports no usage at all, so a
token cap there can never fire. What remained was the shape that
actually hurts — a run that never ends — and a wall clock is the only
bound that needs nothing from the provider.

`timeoutSec` arms one timer when the run starts and aborts when it
fires; every turn boundary re-checks the clock as well, so a late
timer cannot extend the deadline. The note names it in the report:
`[cut short] timeout 600s reached: the run was aborted after 600s.`

The first numbers were invented (600s / 900s) and the journal
rejected them. Folding all **169 completed runs**:

| class         | n   | median | p90  | p95    | max    |
| ------------- | --- | ------ | ---- | ------ | ------ |
| worker        | 125 | 128s   | 650s | 1,745s | 4,037s |
| tester        | 5   | 108s   | —    | 689s   | 689s   |
| explorer      | 23  | 125s   | 274s | 323s   | 630s   |
| code-reviewer | 4   | 294s   | —    | 397s   | 397s   |

A 600s cap would have killed **14 of 169** completed runs (8.3%) and
900s would have killed 11 (6.5%) — every one of them a worker that
was doing real work. The cap therefore sits past the tail of each
class's own history, not at the median of someone's intuition:

| class                            | timeout | why                                                   |
| -------------------------------- | ------- | ----------------------------------------------------- |
| worker, tester, researcher       | 5,400s  | 1.34× the slowest legitimate run (4,037s); cuts 0/169 |
| explorer, planner, code-reviewer | 3,600s  | 5.7× explorer's slowest (630s); cuts 0/169            |

### The hard stop: a guard also bounds the wait

`session.abort()` is async in pi (`abort(): Promise<void>`) and resolves
only when the session goes idle. A provider that ignores the abort — a
dead socket that never yields — left `await session.prompt()` pending
with nothing watching: the guard bounded the child's _intent_ to run,
not the caller's _wait_. That is the last hole, and it is closed.

After a guard fires the runner waits `HARD_STOP_GRACE_MS` (10,000 ms)
for the clean abort. A run that settles inside the grace is `settled`
and keeps its own words; a run still pending when it expires has its
session disposed and carries one more note:
`the child did not stop after the guard fired; its session was disposed 10s later.`

Why 10s, and why disposing is safe — both measured on a real session:

| observation                                              | value                      |
| -------------------------------------------------------- | -------------------------- |
| `dispose()` during a live run settles the pending prompt | **10 ms**                  |
| history after dispose (`messages`)                       | 3 messages, still readable |
| `snapshotHistory` after dispose                          | 3 entries                  |
| a second `dispose()`                                     | no throw                   |
| clean abort after a 4s stall floor                       | ~4s to settle              |

The grace starts **when the guard fires**, not when the await starts.
Arming it up front was a real defect caught by its own regression test:
on a 5,400s run the timer had expired long before the guard spoke, so
the fired branch resolved with no wait and disposed a run that was about
to stop cleanly.

The wait is bounded on purpose: a tool that will not notice
cancellation is abandoned rather than allowed to hold the caller
forever, and the note says so.

A subagent that names no budget at all gets `DEFAULT_TIMEOUT_SEC`
(3,600s) filled in (`effectiveBudget`), so forgetting the field cannot
produce an unbounded run; an explicit `budget: { }` still means
"no caps" because absence and refusal are different statements. Live
falsifier: a 2-second ceiling against a six-file read loop returned in
**2.0s** with `[cut short] timeout 2s reached: the run was aborted
after 2s.` instead of completing the loop.

### The stall watchdog: silence is the failure, not slowness

A timeout answers "how long may this run take". It does not answer
"is this run still alive", and a hung request has no shape a total
budget can catch early: no turn completes, no tool runs, nothing
streams — the parent awaits a promise that never settles, and the
only signal is a clock nobody is watching. `STALL_SEC` watches it.

One timer, re-armed on **any** session event (a streamed token, a
tool start, a tool end, a turn). When it fires the run aborts with
`[cut short] stalled: no session event in 900s; the run was aborted
at 1,240s.` — the silence and the total, so the log says which guard
spoke.

The floor is measured from 9,851 turn/tool gaps across 93 runs:

| statistic                | value                              |
| ------------------------ | ---------------------------------- |
| p50                      | 0.0s                               |
| p90                      | 13.6s                              |
| p99                      | 90.0s                              |
| longest legitimate pause | **391.8s** (after a `bash` call)   |
| gaps ≥ 120s              | 74 (65 after a turn, 9 after bash) |

| floor    | would have cut, in history                                |
| -------- | --------------------------------------------------------- |
| 300s     | **5 runs** — all real work (bash 391.8s, turns 318s/301s) |
| 600s     | 0                                                         |
| **900s** | **0** (2.3× the longest observed pause)                   |
| 1,800s   | 0, but a hang survives 30 minutes                         |

900s is a **system floor, not a budget knob**: it holds even under
`budget: { }`, because "no caps" means no spending caps, not "let a
dead child hold the parent forever". It reuses the timer machinery
`installRunBudget` already owns — no new module, one more
`clearTimeout` on dispose.

Two live falsifiers, both on a real session:

| run                          | floor              | outcome                                                                            |
| ---------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| 40s `sleep` in one bash call | 4s                 | aborted at **4.2s**, `stalled: no session event in 4s; the run was aborted at 6s.` |
| 20s `sleep` in one bash call | **900s (shipped)** | completed at 24.2s, `DONE-AFTER-SLEEP`, `spent: false`                             |

### Wind-down: ask for a status instead of cutting mid-stride

A hard stop loses the only thing the caller wanted: what the run had
done so far. The wall clock now warns first.

When a run has a `timeoutSec` of at least 900s, one timer fires
`WIND_DOWN_SEC` (300s) before the deadline and **steers** a message
into the live child:

> Time check from the caller: about 300 seconds remain before this run
> is stopped. Stop starting new work and do not open new files or
> tools. Reply now with a short status: what you finished, what is
> still unfinished, and the exact state the caller needs to continue
> (files touched, commands run, outputs seen).

`steer` is the right channel: pi delivers it after the current turn's
tools finish and before the next model call, so the child answers
instead of being killed. The note `wrap-up requested with 300s left
before the timeout.` lands in the run's notes only when the message was
actually queued, so a failed request claims nothing.

Why 300s: one summary turn is the whole requirement, and the journal
prices a turn here — p50 7.7s, p90 34.7s, p99 **180.7s** — so 300s is
1.66× the p99 gap. Why the 900s floor: a run whose entire budget is
shorter than the wrap-up would spend its life wrapping up instead of
working.

Live falsifier (real session, timeout 90s, wind-down 30s, a task that
sleeps 12s per file):

```
[60s] wind-down fires, 30s left
elapsed 77s, spent false
notes: … | wrap-up requested with 30s left before the timeout.
report: **Status (stopping now per caller's request):**
  - Finished: f0.txt, f1.txt, f2.txt …
  - Unfinished: f3.txt … f7.txt — never opened.
  - State to resume from: cwd /tmp/…; fil…
```

The run finished **before** the timeout, so `spent` stayed false and the
report is the child's own honest status, not `[cut short]`. If a child
ignores the request, nothing is lost: the timeout still fires and the
notes show both the request and the cut.

### Re-fitting the floor from what the journal keeps

A floor chosen from a proxy cannot be re-checked. The journal records
`run_start`, `turn`, `tool`, `run_end` — so the original 9,851-gap
analysis saw only silences between turns and tools, never between
arbitrary session events, and the number could not be re-derived on
another machine or after a provider change.

`run_end` now carries two integers per run: `gapMaxSec` (longest
silence between **any** two session events) and `gapOver60` (silences
of a minute or more). `trackSession` already subscribes to every event,
so the cost is two comparisons per event and no I/O.

`tools/stall-fit.mts` folds the journal and answers "what would floor N
have cut", with coverage reported honestly:

```
$ npx tsx tools/stall-fit.mts
completed runs: 195
runs with gap data: 0 (older runs predate the field)

$ npx tsx tools/stall-fit.mts --path /tmp/one-live-run.ndjson
completed runs: 1
runs with gap data: 1
per-run longest silence: p50=25s p90=25s p99=25s max=25s
floor   runs cut   of   worst case it would have killed
  900s         0        of 1   -
```

That sample is a real run: `bash: sleep 25; echo GAP-DONE` reported
`gapMaxSec: 25`, exactly the pause it took. Old rows stay `undefined`
rather than `0` — absent data must not read as "no silence" and poison
the fit.

The second line is the one that matters: a long tool call is not a
stall, and the shipped floor leaves 2.3× headroom over the worst one
ever recorded here.

### What counts as a prompt token

The first cut of this cap summed `usage.input` only, and that was
wrong by about six times. Providers report `input` with the cached
part already subtracted — pi-ai's openai-responses path sets
`input: input_tokens - cached - cacheWrite` — so the cached
majority never reached the counter:

- one recorded turn: `input 76,379` but `cacheRead 292,224`, a
  **368,603-token prompt**; the cap saw 21% of it
- every session file on this machine (1,151 with usage):
  **2.13B input against 11.25B cache reads**, so the cap saw 16% of
  real prompt traffic; the worst session 2%
- replaying a 120k cap over 1,482 recorded sessions: input-only
  accounting lets a run continue a median **3.2× longer** and
  never fires at all in 170 sessions where the real prompt passed
  the line

The cap now sums `input + cacheRead + cacheWrite` — the same
prompt-token formula pi itself uses in `cache-stats` and the
footer, so the two accountings agree. One more failure mode got
a voice: if a run completes turns but the provider reports zeros,
the note says
`input budget 120000 idle: the provider reported no usage in 4 turns.`
— an endpoint that answers with zeros (seen live on the free
models: the bridge logged `usage in=0 out=0` 6,893 times, every
model in the log a `*-free` one) cannot enforce a token cap, and
the run must not look budgeted while it is not. The note rides the
run's notes even though the run was not stopped — it shipped muted
at first, because every call site gated the note on the budget
having fired, and an idle budget by definition has not fired.
