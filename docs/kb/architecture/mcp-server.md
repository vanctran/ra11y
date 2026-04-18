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
    │  pure functions over scan       │
    │  results + session state        │
    └─────────────────────────────────┘
             │
             ▼
    Scanner, registries, rules, finders
```

## Files

- `src/mcp/server.ts` — transport. JSON-RPC 2.0 over stdio. Handles `initialize`, `tools/list`, `tools/call`, `prompts/list`, `prompts/get`, `resources/list`, `resources/read`, `logging/setLevel`, `completion/complete`. Zero-dep: `readline` from `node:readline`, JSON from `JSON.parse`. No MCP SDK.
- `src/mcp/session.ts` — per-connection state. Holds the session-level config (`standard`, `level`, `exclude`, `rules`, `nativeWrappers`, `allowWrite`), host roots + capabilities, an AST cache keyed by `(path, mtime)`, and a `loadProjectConfig(cwd)` helper that reads `ra11y.config.ts` fresh every call (no cache — see the notes in `.claude/notes/mcp-iteration.md`).
- `src/mcp/tools.ts` — the tool registry (`MCP_TOOLS`, canonical source of truth for the tool inventory) plus the handful of tools whose handlers fit in one file (`scan`, `scan_file`, `explain_rule`, `list_rules`, `sessionConfigure`). Everything else is one-tool-per-file under `src/mcp/tool-*.ts`.
- `src/mcp/tool-*.ts` — each hosts one tool whose implementation was large enough to warrant its own file (scan-project, scan-diff, detect-wrappers, explain-standard, suggest-fix, apply-fix, coverage, checklist, review-candidates, audit, baseline, list-suppressions, suppress, propose-config, propose-baseline). Supporting internals ride alongside in `tool-*-internals.ts`.
- `src/mcp/prompts/` — prompt templates exposed through `prompts/list` / `prompts/get` (audit, fix, triage). Each prompt is a pure render function over string args; checksums surface in `_meta` so pinning hosts can detect drift.
- `src/mcp/resources/` — `ra11y-kb://` resource index + readers backed by `docs/kb/**`. Read-only; MCP clients pull KB pages on demand without needing filesystem access to the install dir.
- `src/mcp/tools-helpers.ts` — shared utilities: `runScanAndFormat`, `parseFiles`, severity filtering, standard/level resolution. The per-finding shape itself is built by `buildAgentFinding` in `src/output/agent-response/` — a single builder consumed by both the MCP tools here and the CLI `--format agent` output, so the two surfaces can't drift.
- `src/mcp/sampling.ts`, `outbound.ts`, `logging.ts`, `completions.ts` — host-initiated RPC plumbing: server-side sampling via `sampling/createMessage`, outbound-request correlation, log-notification emission gated by level, and argument completion for prompt/resource refs.

## Tools

Canonical inventory: `MCP_TOOLS` in `src/mcp/tools.ts`, mirrored on the wire by `tools/list`. Don't hardcode a count here — it drifts between releases (see CLAUDE.md § 14). The families below group the tools by agent-facing purpose; each family maps to a phase of the triage → fix → verify loop.

**Scan family.** Produce findings + `reviewCandidates` on explicit or project-wide scopes.
- `scan` — explicit paths (files or directories).
- `scan_project` — repo root, auto-promotes to the git root when `cwd` is omitted.
- `scan_file` — single file, reuses the cached AST for the fix-verify loop.
- `scan_diff` — changed-files scan, powered by `git diff`.

**Coverage / discovery family.** Shape the full picture before or after a scan.
- `coverage` — per-standard pass rate + manual-review count with WCAG titles.
- `checklist` — manual-review items with element-relevance hints; prunes by `likelyIrrelevant`.
- `review_candidates` — tier-1 manual-review candidates with snippets + finder `reviewPrompt` text for LLM pass/fail.
- `audit` — end-to-end gated audit covering scan + checklist + review-candidates, with structured `warnings` and nextStep hints.
- `list_rules` — rule-centric discovery, standard-filterable.
- `explain_rule`, `explain_standard` — rule/standard metadata including normative WCAG quote and criterion list.
- `detect_native_wrappers` — onboarding helper; lists PascalCase components frequently appearing with `onClick`, candidates for the `nativeWrappers` config.

**Fix family.** Translate findings into code changes.
- `suggest_fix` — search-and-replace patch; marked low-confidence for info findings.
- `apply_fix` — writes the patch to disk. Gated by session `allowWrite`; off by default.

**Baseline / suppression family.** Stage compliance work across multiple runs.
- `baseline` — current findings as an acceptance baseline for CI.
- `propose_baseline` — AI-review version before committing a baseline.
- `suppress` — emit source-level `ra11y-disable` pragmas for N/A findings.
- `list_suppressions` — read back the current pragmas.
- `propose_config` — suggest `ra11y.config.ts` edits (nativeWrappers, per-rule severity) derived from current findings.

**Session family.** Mutate per-connection state.
- `sessionConfigure` — set `standard`/`level`/`exclude`/`rules`/`nativeWrappers`/`allowWrite` for the current connection. `configure` is accepted as a deprecated alias that layers `warnings: ["deprecated_tool_name_configure"]` onto responses.

## Session lifecycle

1. Host spawns `ra11y --mcp` (or invokes through `.mcp.json`). The process's stdin/stdout become the JSON-RPC channel.
2. Host sends `initialize` with protocol version + capabilities. Server responds with its capabilities (`tools: {}`) and instructions string.
3. Host calls `tools/list`. Server returns every entry in `MCP_TOOLS` with name, description, `inputSchema`, and annotations. Host may also call `prompts/list` and `resources/list` to discover the prompt and KB-resource surfaces.
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
