---
title: "Using the ra11y MCP server from an agent"
topic: pattern
audience: agents, host integrators
---

# Using the ra11y MCP server from an agent

This page is the opinionated workflow for agents. If you're a user setting up the connection, see [`docs/mcp/server-setup.md`](../../mcp/server-setup.md). If you want the tool-by-tool reference, see [`docs/mcp/tool-reference.md`](../../mcp/tool-reference.md).

## The loop

The typical agent workflow on a repo is:

1. **Orient.** Call `scan_project` once, no paths, no overrides — the server auto-promotes to the git root. Read the findings summary.
2. **Configure if needed.** If you see a flood of `keyboard/handler-missing` on PascalCase components, run `detect_native_wrappers` and suggest the user populate `nativeWrappers` in `ra11y.config.ts`. If the project targets WCAG 2.1 instead of 2.2, call `configure`.
3. **Triage info findings.** `info` findings are exactly where you add value — static analysis couldn't resolve them, but reading the source can. Open the referenced file, read the component, verdict yes/no.
4. **Fix errors and warnings.** For each, call `explain_rule` to get spec context + examples, then either apply the rule's suggestion or write a context-aware replacement.
5. **Re-scan.** After editing a file, call `scan_file` — fast, uses the AST cache.
6. **Manual review.** Call `checklist` for the human-oriented view, or `review_candidates` to iterate machine-indexable candidates one-by-one.
7. **Produce artifacts.** Call `coverage` for a status readout. Call `explain_standard` when drafting a VPAT.

## Anti-patterns

- **Raising `minSeverity` to `warning` or `error`.** This filters out the info findings where you add value. Leave it at the default `info`.
- **Re-scanning the whole project after one-file edits.** Use `scan_file`. The AST cache makes it ~10× faster.
- **Asking for coverage before scanning.** `coverage` depends on a recent scan result. Run `scan_project` first.
- **Applying `suggest_fix` with `confidence: "low"` verbatim.** Low confidence means the rule provided prose guidance, not a mechanical patch. Read the suggestion, read the source, write a tailored fix.
- **Ignoring `likelyRelevant: false` items on the checklist.** If the scanner couldn't find `<video>` or `<audio>` in the codebase, the media-related manual-review criteria really don't apply. Deprioritize them.

## Patterns that work well

- **Run `scan_project --changedOnly=true` in CI.** Scope to diffs and the per-PR check stays fast.
- **Use `explain_standard wcag22 --level AA` at the start of a VPAT drafting session** to pull the full criterion list into context.
- **Combine `review_candidates` with source reading.** Each candidate ships a `reviewPrompt` (from the finder that surfaced it) and a `snippet` (source context). Answering the prompt against the snippet is high-signal manual review.
- **Re-scan after every fix.** `scan_file` is cheap; confirming the fix actually resolved the finding (and didn't introduce a regression) catches mistakes immediately.

## Sampling (coming in v0.2)

When sampling-backed tools land (Phase 20), they'll reduce the manual work:

- `resolve_component` — takes a PascalCase finding, reads the component source via host sampling, returns a verdict.
- `verdict_candidate` — takes a review candidate + snippet, uses host sampling to answer the finder's reviewPrompt.
- `draft_vpat_narrative` — uses host sampling to fill VPAT remarks cells.

None of these require ra11y to hold a key — the host's model, the host's billing. See [ADR 0005](../../adr/0005-in-house-mcp-server.md).

## See also

- [`docs/mcp/tool-reference.md`](../../mcp/tool-reference.md) — every tool's inputs and outputs.
- [`docs/kb/architecture/mcp-server.md`](../architecture/mcp-server.md) — how the server works internally.
- [`.claude/notes/mcp-iteration.md`](../../../.claude/notes/mcp-iteration.md) — the 25 rounds of agent feedback that shaped this toolset.
