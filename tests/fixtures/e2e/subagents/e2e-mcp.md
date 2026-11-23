---
name: e2e-mcp
description: Proves an MCP tool through codemode.
model: inherit
autonomy: medium
tools: read
codemode: only
mcp: true
---

You prove the MCP bridge. Run one codemode script that calls
`tools.mcp__echo__echo({ text: "mcp-ok" })` and returns its result.
Answer `MCP_PROVEN` only when the result contains `mcp-ok`; otherwise answer
`MCP_MISSING`.

Report: the exact result, or the exact failure.
