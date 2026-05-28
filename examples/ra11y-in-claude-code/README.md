# Example: ra11y in Claude Code

A minimal reference for wiring the ra11y MCP server into a Claude Code project and teaching the agent how to use it. Copy both files into the root of any project you want Claude Code to audit for accessibility.

## What's here

| File | Purpose |
|---|---|
| [`.mcp.json`](./.mcp.json) | Registers the ra11y MCP server with Claude Code. Uses the explicit `npx -y --package=@ra11y/core ra11y --mcp` form so no global install is required. |
| [`CLAUDE.md`](./CLAUDE.md) | Drop-in instructions for Claude Code — the deterministic v1 workflow (`scan_project` → `checklist` → `suggest_fix` → `verdict_candidate` → `draft_vpat_narrative`), rules of the road, and configuration hooks. Paste the whole file, or append to an existing project `CLAUDE.md`. |

## Install

From the root of the project you want Claude Code to audit:

```sh
cp path/to/this/example/.mcp.json .
cp path/to/this/example/CLAUDE.md CLAUDE.md   # or append its contents to yours
```

Restart Claude Code. The ra11y tools will appear in the agent's tool list. Try:

> Run `scan_project` on this repo and walk me through what needs fixing.

## Why this shape

The workflow in `CLAUDE.md` is deterministic end-to-end — every step grounds on a real file:line or produces a concrete fix pair, and the sampling-backed tools (`verdict_candidate`, `draft_vpat_narrative`) gracefully degrade to an inline prompt on hosts that decline the sampling capability. Claude Code currently declines, so the degraded path is the hot path; nothing in the flow blocks on host sampling.

If you want a bigger tool surface (ecosystem bootstrap, baseline, attestations), the full canonical inventory is discoverable via `tools/list` on the server. The five tools called out here are the v1 inner loop — start there.

## Related

- [`docs/mcp/server-setup.md`](../../docs/mcp/server-setup.md) — host-matrix setup (Claude Code, Cursor, Zed)
- [`docs/mcp/tool-reference.md`](../../docs/mcp/tool-reference.md) — every tool, its inputs, its outputs
- [`docs/kb/architecture/mcp-server.md`](../../docs/kb/architecture/mcp-server.md) — how the server is built internally
- [`docs/kb/architecture/ai-first-consumer.md`](../../docs/kb/architecture/ai-first-consumer.md) — the doctrine the tool responses are shaped against
