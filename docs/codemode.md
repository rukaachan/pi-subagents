# Codemode

Every run gets pi's codemode tool, and the model meets the ordinary
tools through scripts only: one script call can batch many tool calls
in one turn
(parallel reads via Promise.allSettled, filtered searches), and
only the script's result reaches the model. The defect it
addresses, priced from 11 logged runs: 153 single-read turns,
141 of them in back-to-back streaks (avg 7, max 29), and 6/11
runs hit the history cap. A read-only clamp refuses codemode —
scripting never widens autonomy. The tool rides the host's own
factory (extensionFactories), so older pi hosts without the
export simply never load it and the flag is inert.

Harness-growth rule (price of adoption) is satisfied: one
measured defect (the census above — 13.9 single read calls per
capped run on average) buys exactly one stage (the flag), with
the number to beat being the avg-7-turn read streak; dogfood the
next real task to record the after-number.

After-measurement (first real dogfood, explorer map of
resource-loading in pi 1.3.0 dist): 11 codemode scripts batched
37 tool execs (largest batch 5), 0 bare read calls, max read
streak 1, history cap never approached (24 retained messages).
Same ledger, same census script (tools/census.mjs): the
avg-7-turn read streak is now single-turn batches.

Coverage: every starter now carries the tool. The three
read-only starters (planner, researcher, code-reviewer) declare
`tools: read, grep, find, ls, codemode` and gain no write-grade
tool, so the clamp holds by construction. Measured against the
host: a session built with that exact list reports
`_getCallableTools()` as exactly `find, grep, ls, read` — a
script cannot reach a tool the session did not declare.
`planCodemode` grants codemode to a read-only list only when the
list names the id; a list that did not ask for it still gains
nothing.

A/B, 11 paired legs on a real Go repo (opencode-relay), same
prompt and same snapshot per pair, only `worker.md` differing
(`tools/ab-codemode-worker.mts`):

| metric (median per run) | bare  | codemode | delta |
| ----------------------- | ----- | -------- | ----- |
| turns                   | 6     | 5        | −17%  |
| wall seconds            | 22    | 28       | +27%  |
| tools per turn          | 1.17  | 2.60     | +122% |
| usd at 3/15 per M       | 0.106 | 0.132    | +24%  |

Median per-run cost rises, so the flag does not pay for itself on
an ordinary task. What it buys is tail protection: the single
worst bare run cost **$4.76** (22 turns, 1.54M input) against
**$0.15** for the same task with codemode. Batching removed the
one outcome that makes a leg expensive, and the three long tasks
landed within $0.09–0.16 either way. Keep the tool for that tail,
not for the median.

### The worker pool: two codemode workers per pi process

Pi runs at most **two codemode workers per process**, and every
session in that process shares them (host docs, Codemode → Limits).
A subagent that runs a script borrows one for as long as the script
runs, so a fan-out of N codemode legs borrows N at once — and the
parent session's own scripts compete for the same two slots.

Measured on the wire, four legs each holding a worker until one shared
wall-clock moment (`tools/codemode-worker-pool.mts`):

| host                                | legs | outcome                                                                                                                                 |
| ----------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1.3.0                               | 4    | legs 3 and 4 **failed in 3 ms**: `Codemode worker limit reached (2 workers are still running or shutting down). Retry after they exit.` |
| 1.4.0                               | 4    | all four ran; two of them waited ~21 s for a free worker, then ran                                                                      |
| 1.4.0 + `PI_CODEMODE_MAX_WORKERS=4` | 4    | all four ran at once, no wait                                                                                                           |

So the 1.4.0 release turned a hard failure into a queue (60 s, in
arrival order; `PI_CODEMODE_MAX_WORKERS` raises the limit), and the
dev pin moved up to 1.4.0 so the gate runs on that host. Two things
follow for this package:

- a fan-out that puts more codemode legs in flight than workers now
  **says so** — the result text names the legs that must wait
  (`codemodeContentionNote`), because a leg waiting for a worker looks
  exactly like a leg that is stuck;
- the wait burns the waiting leg's own `timeoutSec`, so a short
  timeout on a codemode leg is a shorter budget than it looks.

Checked and clean: our hard stop does **not** poison the pool. A leg
aborted mid-script frees its worker at once, and the next leg gets
one without waiting (`tools/codemode-abort-pool.mts`, both hosts).

##### Twelve legs at once

The subagents themselves run in parallel: the live cap is 12 tasks
(`MAX_LIVE_TASKS`), the fan-out admits up to 12 legs, and each leg
starts in 0–3 ms (`launchBackground`). What the pool limits is how many
**scripts** run at the same moment.

**This package asks for eight workers.** The host ships two per
process and shares them with every session in it, so twelve legs would
queue on two slots. The extension sets
`PI_CODEMODE_MAX_WORKERS=8` when pi loads it (`src/infra/worker-pool.ts`),
and an operator who set that variable keeps their own number — a
smaller one included, because that choice was deliberate.

Measured with 12 legs (`tools/codemode-worker-pool.mts`, host 1.4.0):

| workers              | legs | each script holds | outcome                                                                                                                                   |
| -------------------- | ---- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 2 (host default)     | 12   | 20 s              | all 12 ran; **8 legs waited 1–13 s**; 0 failed                                                                                            |
| 2 (host default)     | 12   | 30 s              | all 12 ran; the longest wait was 25 s; 0 failed                                                                                           |
| 2 (host default)     | 12   | 60 s              | all 12 ran; the longest wait was 55 s — just under the 60 s queue limit; 0 failed                                                         |
| 2 (host default)     | 6    | 150 s             | **2 legs failed**: `Script error: No codemode worker became free within 60 seconds. All 2 workers, shared by every session in this proc.` |
| **8 (this package)** | 12   | 20 s              | all 12 ran; the longest wait was 4 s; 0 failed                                                                                            |
| **8 (this package)** | 12   | 150 s             | all 12 ran; the longest wait was 51 s; 0 failed                                                                                           |
| 12                   | 12   | 20 s              | all 12 ran, **no wait at all**                                                                                                            |

So: twelve subagents do run at the same time, and with eight workers
even a twelve-leg fan-out of long scripts stays inside the host's 60 s
patience. The queue only bites when the legs outnumber the pool by
more than that patience allows. To go wider, raise the pool yourself:

```
PI_CODEMODE_MAX_WORKERS=12 exec pi
```

The host reads the value on every script call, so it can also be set
while pi runs. The parent session's own scripts share the same slots.

### The default: codemode alone

Every subagent gets pi's codemode tool, and the model meets the
ordinary tools through scripts only. The config says so:

| `codemode` | what the model sees                                         |
| ---------- | ----------------------------------------------------------- |
| omitted    | the scripting tool alone (the default)                      |
| `only`     | the scripting tool alone (the default, said out loud)       |
| `true`     | the scripting tool beside the ordinary tools (pi's default) |
| `false`    | no scripting: the ordinary tools, called directly           |

A subagent whose prompt does not teach scripts gets the route
appended, so a plain prompt still works:

```
Tool route:
- Your tools run inside codemode scripts, not as direct calls.
- Batch independent reads and searches into ONE script with Promise.allSettled.
- Keep each edit or write in its own script, one change per script.
- tools.bash resolves even when the command fails. Guard it: ...
- If a result says "Script failed": the return value never ran. ...
```

Measured live on a plain prompt with no codemode flag at all
(`tools/script-route-probe.mts`): the route was taught, the run used
scripts, and it finished in 11 s over 3 turns.

### Codemode alone: the mode that pays

Pi hides the ordinary tools from the model when codemode runs in
**"only"** mode: the model gets the scripting tool alone and reaches
read, grep, find, ls, edit, write, and bash through scripts. The
subagent config picks the mode: `codemode: true` (scripting beside
the tools) or `codemode: only` (scripting alone, the package default).

Measured with three arms, one variable (the tool policy the model
sees), same task, same repo snapshot, same model, paired order
(`tools/ab-codemode-mode.mts`):

| arm                | read-heavy task             | write task                  |
| ------------------ | --------------------------- | --------------------------- |
| bare (no codemode) | 28 s · $0.080 · 5 turns     | 32 s · $0.060 · 5 turns     |
| `codemode: true`   | 33 s · $0.146 · 5 turns     | 28 s · $0.060 · 5 turns     |
| `codemode: only`   | **31 s · $0.075 · 4 turns** | **21 s · $0.050 · 3 turns** |

(medians; read task n=5 per arm, write task n=4 per arm, one model,
one Go repo. Cost at $3/$15 per M tokens.)

What the numbers say:

- **"only" costs what bare costs** ($0.075 vs $0.080 on the read task,
  $0.050 vs $0.060 on the write task) and turns fewer times. It is not
  a discount — it is the same bill with fewer round trips.
- **"true" is the worst of the three.** Every request carries the tool
  schemas _and_ the codemode description, and the model mixes the two:
  on the read task it billed $0.146 — nearly double bare — while
  finishing no faster. That was the mode every starter shipped with.
- **Faster is not the same everywhere.** On the write task "only" won
  clearly (21 s vs 32 s, and every run made the edit). On the read
  task it matched bare on time (31 s vs 28 s) and paid for it with a
  longer tail: the slowest leg took 129 s against bare's 59 s. A
  waiting leg is bounded by the subagent's own `timeoutSec`, and the
  wind-down asks for the report before the clock runs out.

So every starter now ships `codemode: only`, and its prompt says what
is true: the scripting tool is the only tool, one script per phase
for reads, one script per edit or write so each change stays
reviewable. The shipped `worker` starter, measured on the write task
(n=4): 17.5 s median, $0.063 median, 4 turns, the edit made and the
build green in every run.

Two rules keep the option honest:

- the clamp does not move. Scripts reach the session's own tools, so
  a read-only list stays read-only whatever the mode says. `only`
  changes what the _model_ sees, not what a script may call;
- an old host without the codemode factory keeps the ordinary tools
  and says so in the run notes. A leg never ends up with no tool at
  all.
