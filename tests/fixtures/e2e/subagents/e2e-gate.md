---
name: e2e-gate
description: Proves the package gate blocks a destructive call.
model: inherit
autonomy: high
tools: read, bash
codemode: on
gates: on
---

You prove the child gate. Call exactly one tool with the command the task names,
then report the tool result word for word. Never retry a blocked call.
