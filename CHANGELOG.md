# Changelog

All notable changes to ra11y are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — see `CLAUDE.md` section 14 for the ra11y-specific semver policy.

## [Unreleased]

## [0.1.0] — 2026-04-13

This is the first public release of ra11y: a zero-dependency, multi-standard accessibility scanner for JSX/TSX, HTML, and CSS. It covers WCAG 2.2 A+AA and WCAG 2.1 A+AA with 49 automated rules, ships four conformance standards, and publishes with npm provenance.

### Added

#### Architecture
- Three-layer architecture: standards → criteria → rules, glued by a reciprocal `equivalentTo` closure so one rule can cite every conformance framework simultaneously.
- Engine: scanner, rule-runner, context-builder, AST helpers, standard-filter, and three registries (standards, criteria, rules). ~500 lines end-to-end.
- Zero-runtime-dependency invariant enforced by `scripts/check-zero-deps.ts` — `dependencies: {}` in `package.json`.
- Network-isolation invariant enforced by `scripts/check-network-isolation.ts` — `src/` cannot reference `fetch`, `node:http`, `node:https`, `node:net`, or `node:dns`.
- File/function/nesting-depth guard enforced by `scripts/check-limits.ts` (500/120/5).
- Import-cycle guard enforced by `scripts/check-cycles.ts` (Tarjan SCC).
- Build pipeline via `scripts/build.ts` (Bun.build for ESM JS + tsc for .d.ts).
- Benchmark suite enforcing CLAUDE.md §13 budgets. Current headroom: 1000 files in ~170ms (budget: 3000ms), cold start ~33ms (budget: 200ms).

#### Standards (4 built-in)
- **WCAG 2.2** — all 87 success criteria with automatability classification.
- **WCAG 2.1** — 78 criteria with `equivalentTo` links back to WCAG 2.2.
- **Section 508 (2017 refresh)** — 38 criteria equivalent to WCAG 2.0 A+AA.
- **EN 301 549 v3.2.1** — 50 criteria equivalent to WCAG 2.1 A+AA.

#### Rules (49 built-in)

**ARIA**
- `aria/hidden-focus` (wcag22:4.1.2) — flags `aria-hidden` on focusable elements
- `aria/invalid-role` (wcag22:4.1.2) — flags roles outside the WAI-ARIA 1.2 dictionary, suggests the nearest valid role via edit-distance
- `aria/live-region-valid` (wcag22:4.1.3) — flags invalid `aria-live` values and conflicting politeness attributes
- `aria/required-attrs` (wcag22:4.1.2) — flags ARIA roles missing required state attributes
- `aria/valid-attr` (wcag22:4.1.2) — flags `aria-*` attributes not in the WAI-ARIA 1.2 dictionary

**Contrast**
- `contrast/enhanced` (wcag22:1.4.6) — WCAG AAA enhanced contrast check
- `contrast/minimum` (wcag22:1.4.3) — WCAG AA contrast ratio check with large-text heuristic
- `contrast/non-text` (wcag22:1.4.11) — non-text contrast check for UI components and graphical objects

**Document**
- `document/iframe-title` (wcag22:4.1.2, 2.4.1) — flags iframes without a title or aria-label
- `document/lang-attribute` (wcag22:3.1.1) — flags HTML root without a lang attribute
- `document/lang-on-parts` (wcag22:3.1.2) — flags content in a different language without a lang override
- `document/meta-refresh` (wcag22:2.2.1, 2.2.4, 3.2.5) — flags `<meta http-equiv=refresh>` auto-redirects
- `document/page-titled` (wcag22:2.4.2) — flags documents without a meaningful `<title>`
- `document/viewport-zoom` (wcag22:1.4.4, 1.4.10) — flags `<meta viewport>` that disables pinch-to-zoom

**Focus**
- `focus/not-obscured` (wcag22:2.4.11) — flags focused components fully hidden by sticky headers or overlays
- `focus/outline-visible` (wcag22:2.4.7, 2.4.11) — flags elements where focus outline is suppressed without a replacement
- `focus/tabindex-positive` (wcag22:2.4.3) — flags positive tabindex values

**Forms**
- `forms/autocomplete-missing` (wcag22:1.3.5) — flags personal-info inputs without an autocomplete token
- `forms/fieldset-legend` (wcag22:1.3.1, 3.3.2) — flags fieldset without a legend
- `forms/label-for-id-mismatch` (wcag22:1.3.1) — flags `label[for=X]` where no element has `id=X`
- `forms/labels-required` (wcag22:1.3.1, 3.3.2, 4.1.2) — flags form controls without an accessible label
- `forms/non-empty-label` (wcag22:1.3.1, 3.3.2) — flags label elements with no visible text content

**Keyboard**
- `keyboard/accesskey-duplicate` (wcag22:2.1.1) — flags multiple elements sharing an accesskey value
- `keyboard/character-shortcuts` (wcag22:2.1.4) — flags single-character keyboard shortcuts without a remapping mechanism
- `keyboard/handler-missing` (wcag22:2.1.1) — flags clickable elements without a keyboard handler

**Layout**
- `layout/orientation-lock` (wcag22:1.3.4) — flags CSS that locks display to a single orientation
- `layout/reflow-hardcoded-width` (wcag22:1.4.10) — flags hardcoded pixel widths that break reflow at 320px
- `layout/text-spacing` (wcag22:1.4.12) — flags CSS declarations that would override text-spacing overrides

**Media**
- `media/alt-text-missing` (wcag22:1.1.1) — flags images without a text alternative
- `media/autoplay-sound` (wcag22:1.4.2) — flags audio/video autoplay without muted or controls
- `media/video-captions-missing` (wcag22:1.2.2) — flags `<video>` without a `<track kind="captions">`

**Motion**
- `motion/pause-stop-hide` (wcag22:2.2.2) — flags animated content without a mechanism to pause, stop, or hide

**Navigation**
- `navigation/link-descriptive-text` (wcag22:2.4.4) — flags link text like "click here" or "read more"
- `navigation/link-no-href` (wcag22:2.1.1, 4.1.2) — flags `<a onClick>` without an href
- `navigation/skip-link` (wcag22:2.4.1) — flags pages without a skip-navigation link

**Parsing**
- `parsing/duplicate-id` (wcag22:4.1.1) — flags duplicate `id` attributes in a document
- `parsing/html-has-lang` (wcag22:3.1.2) — flags syntactically invalid BCP 47 lang values

**Pointer**
- `pointer/cancellation` (wcag22:2.5.3) — flags pointer event handlers that fire on down-event without an up-event abort path
- `pointer/drag-alternative` (wcag22:2.5.7) — flags drag-only interactions without a single-pointer alternative
- `pointer/target-size` (wcag22:2.5.8) — flags interactive targets below the minimum 24×24px target size

**Semantics**
- `semantics/button-name` (wcag22:4.1.2) — flags buttons without an accessible name
- `semantics/empty-heading` (wcag22:1.3.1, 2.4.6) — flags heading elements with no text content
- `semantics/heading-hierarchy` (wcag22:1.3.1) — flags skipped heading levels and missing `<h1>`
- `semantics/label-in-name` (wcag22:2.5.3) — flags components where the accessible name does not contain the visible label text
- `semantics/landmark-main` (wcag22:1.3.6, 2.4.1) — flags pages without a `<main>` landmark
- `semantics/list-structure` (wcag22:1.3.1) — flags `<li>` outside a list container and lists with non-`<li>` children
- `semantics/nested-interactive` (wcag22:4.1.2) — flags interactive elements nested inside other interactive elements
- `semantics/table-headers` (wcag22:1.3.1) — flags data tables without `<th>` header cells

**Tooltip**
- `tooltip/dismissable` (wcag22:1.4.13) — flags tooltips that cannot be dismissed without moving focus or pointer

#### Parsers (zero-dep, in-house)
- TSX/JSX parser — character-driven, preserves PascalCase components, recognizes HTML5 void elements; fuzz-tested.
- HTML parser — HTML5-quirks-aware, explicit progress guarantees to prevent hangs on malformed input; fuzz-tested.
- CSS parser — rules, at-rules, nested `@media`/`@supports`/`@keyframes`, `!important`, comments, function calls.
- Tailwind class extractor — extracts utility class strings and resolves Tailwind tokens to CSS declarations for contrast checking.

#### Output formatters (7)
- `terminal` — colored output, snippet rendering, coverage scorecard.
- `plain` — color-free terminal output for piping.
- `json` — machine-readable ScanResult + ReportData.
- `sarif` — SARIF 2.1.0 for GitHub code scanning integration.
- `junit` — JUnit XML for CI test-result UIs.
- `markdown` — PR-comment-friendly markdown report.
- `agent` — compact format optimized for AI coding agent consumption.

#### MCP server
- In-house Model Context Protocol server for AI agent integration (`ra11y mcp`).
- Tools: `scan_file`, `scan_project`, `get_checklist` — each returning structured violation data, coverage ratios, and next-step hints.
- Git-aware scanning, per-rule severity overrides, `nativeWrappers` allowlist, `.gitignore` respect.

#### CLI
- `scan` command with `--standard`, `--level`, `--exclude`, `--fail-on`, `--format`, `--no-color`, `--verbose`, `--quiet`, `--debug`.
- `--changed` — scan only git-staged files (precommit-friendly).
- `--since <ref>` — scan only files changed since a git ref.
- `--baseline=create|check|update` — baseline mode with sha1 fingerprinting (line-number-independent).
- `--baseline-file=<path>` — override the default `.ra11y-baseline.json` path.
- `--list-rules`, `--list-standards`, `--explain <ruleId>` — introspection commands.
- `--coverage`, `--checklist`, `--vpat`, `--certification` — structured report commands.
- `init` and `doctor` commands for project setup and diagnostics.
- Exit codes: 0 clean, 1 violations, 2 errors, 3 new baseline violations.

#### Configuration
- `ra11y.config.ts`, `.js`, `.mjs`, `.json` — config loader walks up from cwd, stops at `.git`.
- `--config <path>` / `RA11Y_CONFIG` environment variable to override auto-discovery.
- Per-rule severity overrides (`"error" | "warning" | "info" | "off"`).
- Per-directory `overrides` array with last-match-wins precedence.
- `nativeWrappers` allowlist to suppress `keyboard/handler-missing` on custom components.
- Inline disable pragmas: `ra11y-disable-next-line`, `ra11y-disable`/`ra11y-enable`.
- Supported comment styles: `//`, `/* */`, `<!-- -->`, `{/* */}`.

#### Plugin API
- `defineRule()`, `defineStandard()`, `defineFormatter()`, `defineConfig()` — typed identity helpers exported from `@ra11y/core/plugin`.
- Plugin rule example: [`examples/plugin-rule/`](./examples/plugin-rule/).
- Plugin standard example: [`examples/plugin-standard/`](./examples/plugin-standard/).

#### Developer experience
- Precommit git hook: `.githooks/pre-commit` + `.githooks/commit-msg` (installed via `bun run setup`).
- Conventional-commit enforcement via `scripts/check-commit.ts`.
- Claude Code autonomous infrastructure: hooks, 15 subagents, 12 skills, persistent backlog.
- In-house utilities: ANSI coloring, contrast math, args parser, logger, gitignore-style glob matcher, string width.

#### Documentation
- [`docs/getting-started.md`](./docs/getting-started.md) — install, first scan, interpreting output, fixing a violation.
- [`docs/cli.md`](./docs/cli.md) — full flag reference and exit-code table.
- [`docs/configuration.md`](./docs/configuration.md) — config file spec, rule settings, per-directory overrides, precedence.
- [`docs/architecture.md`](./docs/architecture.md) — three-layer model, equivalence closure, rule execution lifecycle, plugin boundaries.
- 5 ADRs covering zero-dep invariant, three-layer model, TypeScript peer, Bun test runner, and in-house MCP server.
- `docs/kb/` agent-retrieval knowledge base: rules, standards, architecture concepts, gotchas, patterns.
