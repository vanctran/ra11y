---
topic: mcp-iteration
updated: 2026-04-12
---

# MCP server iteration notes

Captures design decisions and deferred items from ~25 rounds of agent feedback on the MCP server (Phase 1 of `.claude/handoff-mcp-and-agent.md`). Read this before modifying anything in `src/mcp/` or you'll relitigate settled questions.

## Status

Phase 1 (MCP server) is **complete and shipped**. `src/mcp/` has 10 tools wired through `src/cli.ts --mcp`:

| Tool | Purpose |
|------|---------|
| `scan` | Scan explicit paths |
| `scan_project` | Scan repo root; auto-promotes to git root when `cwd` omitted; supports `changedOnly`/`since` for CI-on-diff |
| `scan_file` | Single-file re-scan; uses AST cache |
| `detect_native_wrappers` | Onboarding tool — lists PascalCase `onClick` components as candidates for `nativeWrappers` config |
| `explain_rule` | Full rule metadata + WCAG normative quote |
| `suggest_fix` | Search-and-replace patch (low-confidence for info findings) |
| `coverage` | Per-standard pass rate + manual-review count with WCAG titles |
| `checklist` | Manual-review items with element-relevance hints (`likelyRelevant: false` for media criteria when no `<video>`/`<audio>`) |
| `list_rules` | Discovery |
| `configure` | Session-level `standard`/`level`/`exclude`/`rules`/`nativeWrappers` |

Verified on leela (329 files, ~30ms full scan, zero false-positive violations).

## Settled decisions — DO NOT CHANGE without reading this first

### Severity names stay `error` / `warning` / `info`

Agents repeatedly suggest renaming `info` to `review` or `unresolved` because "info reads as ignorable." **Don't.** The Severity type is in `src/types/violation.ts` and used by ~100 files, public API, formatters, tests. The `confidence: "low"` field + explicit message text ("looks good if it renders a <button> — verify by reading the source") already carry the semantic. Renaming is a breaking change for cosmetic gain.

### `nativeWrappers` is the right abstraction for keyboard/handler-missing noise

Don't add per-rule component allowlist fields to `rules`. Don't name-heuristic ("ends with `Button`"). The file `ra11y.config.ts` + session `configure({nativeWrappers})` is the right knob — surgical, keeps rule firing on real `<div onClick>` bugs.

### `session.projectConfigs` cache was removed for a reason

`loadProjectConfig(cwd)` now calls `loadConfig` fresh every scan. The previous cache silently returned `null` after a config file was created partway through a session. Don't re-add the cache. Config load is cheap (<10ms); correctness beats memoization.

### The parsers maintain `#line`/`#col` incrementally in `#advance()`

All three parsers (html.ts, tsx.ts, css.ts) were O(n²) because `#position()` rescanned from offset 0 on every call. Leela's 2MB eval-result HTML never returned. Fix: track `#line`/`#col` as state, update in `#advance(n)`, return in O(1) from `#position()`. **Do not regress this** — if you see a `for (let i = 0; i < this.#pos; i++)` pattern in a new parser, you've reintroduced the bug.

### Auto-promote to git root is silent

`scan_project` without `cwd` promotes to `gitRoot(process.cwd())`. Don't add a `cwdAutoPromotedFromGitRoot` flag or any other "look, we promoted!" signal. `meta.scannedRoot` already tells the truth. Adding an obscure boolean made agents ask "what does that mean?"

### `configHint` only fires when helpful

Emitted only when: `configSource === null` AND `cwd` wasn't explicitly passed AND we didn't auto-promote to the git root. If we promoted and still didn't find a config, the project simply doesn't have one — don't nag.

### Zero-dep invariant applies to MCP too

In-house JSON-RPC 2.0 (`src/mcp/server.ts`), ~200 lines. Do not add `@modelcontextprotocol/sdk`. Do not add `axe-core`. The server instructions name axe-core-in-Playwright as the runtime companion — that's prose, not a dependency.

### Don't bundle runtime test generation

Agents keep suggesting a `runtime_plan` tool or axe-playwright scaffolder. **No.** Different architecture (rendered DOM vs source), different product. ra11y points at the companion; it doesn't own it.

### Coverage reports raw counts, not composite percentages

We briefly had `overallAutomatedCoverage: passing / total`. Agents read "54%" as failure when it actually measured "the rule library automates 54% of WCAG." That's a property of the tool, not a grade. Surface raw counts (`criteriaTotal`, `criteriaAutomatable`, `criteriaManualReviewRequired`) and let agents form their own ratios.

### `info` severity is the default, by design

The server instructions and tool descriptions steer agents to keep `minSeverity: "info"`. Info findings are where an agent adds value over CI — cases where source reading resolves what static analysis can't. Don't "helpfully" filter these out.

## Deferred by design — with reasoning

### Same-file component resolution
**Why deferred**: the TsxModule AST doesn't carry function/const declarations at the module level, only JSX. Adding module-level declaration tracking to the parser is real work for a marginal win — most React codebases don't have the wrapper defined in the same file. Phase 2 (`--fix` with LLM) handles this cleanly by following imports.

### Tailwind cross-file class resolution
**Why deferred**: requires a Tailwind-aware parser that correlates CSS `outline: none` with JSX `className="focus-visible:ring-3"`. Phase 5 parser work. Current state: `focus/outline-visible` downgrades class-scoped selectors to `info` and the suggestion mentions Tailwind. False-positive rate is acceptable.

### Fix suggestion renaming across the board
`fixSuggestionAvailable` is the current field (renamed from `autoFixable` because there's no auto-apply). The suggestions for info findings are prose guidance, not patches — keep as-is; agents read `confidence: "low"` as the "this is guidance" signal.

### Finding-level WCAG titles
Coverage output carries `{id, title, level}` objects; per-finding `criteria` stays bare IDs. Findings already have descriptive `message` + `ruleId` — adding titles there would duplicate info.

## Architectural tripwires

Patterns that look like improvements but aren't:

1. **Re-adding a projectConfig cache.** Silent staleness is worse than a cheap reload.
2. **Adding an `info` → `note` severity rename.** 100+ files; the confidence field already carries the signal.
3. **Bundling axe-core or any runtime tester.** Different architecture, different zero-dep story.
4. **Hiding files by size threshold.** The user's call via `.gitignore` or `--exclude`, not ours.
5. **Name-heuristic allowlisting** (e.g., "components ending in `Button` are safe"). Will bite on the first `MyButton` that wraps a `<div>`.
6. **Composite coverage percentages** (passing / total including manual). Reads as failure; raw counts + summary prose is honest.

## Next actionable: MCP Phase 2 — the `--fix` command

`.claude/handoff-mcp-and-agent.md` §Part 2 is untouched. That's the "turnkey LLM workflow" — `ra11y --fix src/` uses the Anthropic API to resolve findings by reading component sources. Ships in v0.2.0. Architecture sketch in the handoff doc.

Prereq: `scripts/check-network-isolation.ts` needs a carve-out for `src/agent/` (the only part of `src/` allowed to use `fetch`, and only for the LLM API).

## File map

- `src/mcp/server.ts` — JSON-RPC 2.0 stdio server
- `src/mcp/session.ts` — Session state + AST cache (by mtime)
- `src/mcp/tools.ts` — Tool registry + scan/scan_file/suggest_fix/explain_rule/coverage/list_rules/configure handlers
- `src/mcp/tool-scan-project.ts` — scan_project handler (extracted for file-size budget + git-aware logic)
- `src/mcp/tool-detect-wrappers.ts` — onboarding tool for nativeWrappers
- `src/mcp/tool-checklist.ts` — checklist with element-relevance hints
- `src/mcp/tools-helpers.ts` — shared helpers (formatFinding, runScanAndFormat, etc.)
- `tests/unit/mcp/` — tool handler tests
- `tests/integration/mcp-session.test.ts` — spawns the server as subprocess, drives full JSON-RPC loop
- `.mcp.json` — Claude Code configuration at repo root

## See also

- `.claude/handoff-mcp-and-agent.md` — original spec; Part 2 (`--fix`) still open
- `CLAUDE.md` §3 — architectural invariants (zero-dep, network isolation, etc.)
- `docs/kb/architecture/three-layer-model.md` — Standards/Criteria/Rules layering the MCP sits on top of
