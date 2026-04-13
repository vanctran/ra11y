---
title: "MCP server architecture"
topic: architecture
audience: agents, contributors
---

# MCP server architecture

The MCP server is the primary way agents interact with ra11y. It's a stdio-based JSON-RPC 2.0 server implemented in `src/mcp/` — ~200 lines of transport code plus one file per tool. See [ADR 0005](../../adr/0005-in-house-mcp-server.md) for the decision rationale.

## Wire-level picture

```
    Host (Claude Code / Cursor / Zed)
             │  stdio
             ▼
    ┌─────────────────────────────────┐
    │  src/mcp/server.ts              │
    │  - JSON-RPC framing (readline)  │
    │  - initialize / tools/list      │
    │  - tools/call dispatch          │
    └─────────────────────────────────┘
             │  session state (AST cache, config)
             ▼
    ┌─────────────────────────────────┐
    │  src/mcp/session.ts             │
    │  - per-session config           │
    │  - AST cache by (path, mtime)   │
    │  - loadProjectConfig(cwd)       │
    └─────────────────────────────────┘
             │  tool handlers
             ▼
    ┌─────────────────────────────────┐
    │  src/mcp/tools*.ts              │
    │  12 tools, pure functions over  │
    │  scan results + session state   │
    └─────────────────────────────────┘
             │
             ▼
    Scanner, registries, rules, finders
```

## Files

- `src/mcp/server.ts` — transport. JSON-RPC 2.0 over stdio. Handles `initialize`, `tools/list`, `tools/call`. Zero-dep: `readline` from `node:readline`, JSON from `JSON.parse`. No MCP SDK.
- `src/mcp/session.ts` — per-connection state. Holds the session-level config (`standard`, `level`, `exclude`, `rules`, `nativeWrappers`), an AST cache keyed by `(path, mtime)`, and a `loadProjectConfig(cwd)` helper that reads `ra11y.config.ts` fresh every call (no cache — see the notes in `.claude/notes/mcp-iteration.md`).
- `src/mcp/tools.ts` — the tool registry (`MCP_TOOLS`) and the six tools whose handlers fit in one file: `scan`, `scan_file`, `explain_rule`, `suggest_fix`, `coverage`, `list_rules`, `configure`.
- `src/mcp/tool-scan-project.ts`, `tool-checklist.ts`, `tool-detect-wrappers.ts`, `tool-explain-standard.ts`, `tool-review-candidates.ts` — each hosts a single tool whose implementation was large enough to warrant its own file.
- `src/mcp/tools-helpers.ts` — shared utilities: `formatFinding`, `runScanAndFormat`, `parseFiles`, severity filtering, standard/level resolution.

## The 12 tools

| Tool | Purpose |
|------|---------|
| `scan` | Scan explicit paths. Returns findings grouped by file with fix suggestions. |
| `scan_project` | Scan the repo root. Auto-promotes to the git root when `cwd` is omitted. Supports `changedOnly` / `since` for CI-on-diff. |
| `scan_file` | Single-file re-scan using the cached AST. Use in the fix-verify loop after editing one file. |
| `detect_native_wrappers` | Onboarding tool. Lists PascalCase components frequently appearing with `onClick` — the candidates for the `nativeWrappers` config knob. |
| `explain_rule` | Full rule metadata + WCAG normative quote. |
| `explain_standard` | Loaded standard's metadata + criterion list, level-filterable. |
| `suggest_fix` | Search-and-replace patch (low-confidence for info findings). |
| `coverage` | Per-standard pass rate + manual-review count, with WCAG titles. |
| `checklist` | Manual-review items with element-relevance hints. `likelyRelevant: false` for media criteria on codebases with no `<video>`/`<audio>`. |
| `review_candidates` | Tier-1 manual-review candidates with source snippets + finder reviewPrompts for LLM pass/fail. |
| `list_rules` | Rule-centric discovery. |
| `configure` | Session-level `standard`/`level`/`exclude`/`rules`/`nativeWrappers`. |

## Session lifecycle

1. Host spawns `ra11y --mcp` (or invokes through `.mcp.json`). The process's stdin/stdout become the JSON-RPC channel.
2. Host sends `initialize` with protocol version + capabilities. Server responds with its capabilities (`tools: {}`) and instructions string.
3. Host calls `tools/list`. Server returns all 12 tool definitions with JSON schemas.
4. Host calls `tools/call` with a name + arguments. Server dispatches, runs the handler with the session object, returns the result.
5. AST cache fills on first scan of a file; subsequent `scan_file` calls skip parsing when mtime hasn't changed.
6. Session config mutates only via the `configure` tool. `loadProjectConfig(cwd)` runs fresh each tool call — no staleness.
7. Connection closes when stdin closes. Session state is discarded.

## Invariants (do not regress)

1. Zero deps. No `@modelcontextprotocol/sdk`.
2. Every tool handler is a pure function over `(params, session)` — no mutation of the scanner, no module-level state.
3. Severity names stay `error` / `warning` / `info`. The `confidence: "low"` field + explicit message text carries the "this needs verification" semantic; renaming `info` breaks ~100 files and the public API for cosmetic gain.
4. `session.projectConfigs` cache was removed for correctness; don't re-add.
5. Parsers maintain `#line` / `#col` incrementally in `#advance()`. The O(n²) position-recompute bug returns the moment someone writes `for (let i = 0; i < this.#pos; i++)` in a new parser.
6. `scan_project` auto-promotes to git root silently. No "we promoted!" flag. `meta.scannedRoot` already tells the truth.

Full decision log: `.claude/notes/mcp-iteration.md`. Read it before changing anything under `src/mcp/`.

## Why sampling matters for Phase 20

Currently no tool calls an LLM. `review_candidates` returns the candidate + the finder's `reviewPrompt`; the agent runs the prompt against the host's model. That's fine but requires the agent to know to do it.

Phase 20 adds sampling-backed tools that initiate the LLM call from the server side via `sampling/createMessage`. The host runs the completion on its model and returns the answer. Planned: `resolve_component`, `verdict_candidate`, `draft_vpat_narrative`.

ra11y never holds an API key. Zero-dep invariant preserved.

## See also

- [ADR 0005](../../adr/0005-in-house-mcp-server.md) — why in-house JSON-RPC and why sampling over a bundled LLM client.
- [`.claude/notes/mcp-iteration.md`](../../../.claude/notes/mcp-iteration.md) — 25 rounds of agent feedback and the settled-decisions list.
- [`docs/mcp/server-setup.md`](../../mcp/server-setup.md) — user-facing setup guide.
- [`docs/kb/patterns/using-mcp-from-agents.md`](../patterns/using-mcp-from-agents.md) — the agent-side workflow.
