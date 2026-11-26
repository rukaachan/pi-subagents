# Codemode

Codemode gives a child one scripting tool. The model writes a JavaScript
script and the script calls the child's own tools. Only the script result
comes back, so one script can batch many reads or searches into one turn.

## Modes

| `codemode` value | What the child sees                               |
| ---------------- | ------------------------------------------------- |
| omitted          | Scripting alone. This is the package default.     |
| `off`            | No scripting; ordinary tools are called directly. |
| `on`             | Scripting beside the ordinary tools.              |
| `only`           | Scripting alone, stated explicitly.               |

Scripts can reach only the tools the session already has. A read-only
subagent stays read-only in every mode.

The setting can also come from `pi-subagents` settings or a per-run
`Task` switch.

## The route rule

A prompt that does not mention scripts gets a short route appended:

```text
Tool route:
- Your tools run inside codemode scripts, not as direct calls.
- Batch independent reads and searches into ONE script with
  Promise.allSettled.
- Keep each edit or write in its own script, one change per script.
- tools.bash resolves even when the command fails. Guard it:
  r.status === "fulfilled" && r.value.exit_code === 0.
- If a result says "Script failed": the return value never ran. Read the
  error, fix the code, retry once.
```

This keeps a plain subagent prompt usable without teaching codemode in
every file. A prompt that already teaches scripts is left alone.

## Worker pool

The host runs codemode scripts on a small number of workers. Every
session in one Pi process shares them. The package sets
`PI_CODEMODE_MAX_WORKERS` at load to the live cap (default 12), unless
the operator already set it. A deliberate smaller value is kept.

If more legs want scripts than there are workers, the extra scripts wait
in arrival order. The wait counts against the waiting leg's own
`timeoutSec`. The run text names the waiting legs so a queue does not
look like a hang.

The host waits up to 60 s for a worker. A short timeout on a codemode leg
is therefore shorter than it looks when the pool is busy.

To go wider than the live cap, raise both:

```bash
PI_CODEMODE_MAX_WORKERS=16 exec pi
```

The host reads this value on each script call; the parent session's own
scripts use the same pool.

## When to use it

Use `only` for read-heavy work where batching searches and reads matters.
One script can run many lookups and return the distilled result. Keep
each write or edit in its own script so the change stays reviewable.

Use `on` when the task mixes a few scripts with ordinary direct tool
calls. The model may choose either path.

Use `off` when a direct tool call is clearer, when the host is too old to
provide codemode, or when a script adds no value.

There is no correctness difference between the modes. The difference is
how the model meets the tools and how many round trips it needs.

## Safety

Codemode does not widen the tool policy. The script runs inside the
child's session, with the child's clamped tools, model, paths fence, and
guards. A read-only list cannot write through a script.

A failed script returns an error; it does not partially apply a promised
result. The next script can retry with the failing call removed. A
script that throws before returning leaves no result for the caller.

## Related settings

- `tools` decides which tools a script can reach.
- `paths` turns off shell tools and limits writes.
- `mcp: true` opens MCP servers; scripts call them as
  `tools.mcp__<server>__<tool>`.
- `budget.timeoutSec` bounds the script and the run.
