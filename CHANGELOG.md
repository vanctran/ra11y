# Changelog

All notable changes to ra11y are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — see `CLAUDE.md` section 14 for the ra11y-specific semver policy.

## [Unreleased]

### Added

#### Architecture
- Three-layer architecture: standards → criteria → rules, glued by a reciprocal `equivalentTo` closure so one rule can cite every framework simultaneously.
- Engine: scanner, rule-runner, context-builder, AST helpers, standard-filter, and three registries (standards, criteria, rules). ~500 lines end-to-end.
- Zero-runtime-dependency invariant enforced by `scripts/check-zero-deps.ts` — `dependencies: {}` in `package.json`.
- Network-isolation invariant enforced by `scripts/check-network-isolation.ts` — `src/` cannot reference `fetch`, `node:http`, `node:https`, `node:net`, or `node:dns`.
- File/function/nesting-depth guard enforced by `scripts/check-limits.ts` (500/120/5).
- Import-cycle guard enforced by `scripts/check-cycles.ts` (Tarjan SCC).
- Build pipeline via `scripts/build.ts` (Bun.build for ESM JS + tsc for .d.ts with `rewriteRelativeImportExtensions`).
- Benchmark suite via `scripts/bench.ts` enforcing CLAUDE.md §13 budgets (cold start 200ms, 10/100/1000 files in 100/500/3000ms). Current headroom: 1000 files in ~70ms, cold start ~25ms.

#### Standards
- **WCAG 2.2** — all 87 success criteria with automatability classification.
- **WCAG 2.1** — 78 criteria derived from the WCAG 2.2 data table with appropriate `equivalentTo` links.
- **Section 508 (2017 refresh)** — 38 criteria equivalent to WCAG 2.0 A+AA.
- **EN 301 549 v3.2.1** — 50 criteria equivalent to WCAG 2.1 A+AA.

#### Rules (29 built-in)
- `aria/hidden-focus` (wcag22:4.1.2) — flags aria-hidden on focusable elements (natively or via tabindex)
- `aria/invalid-role` (wcag22:4.1.2) — flags role values outside the WAI-ARIA 1.2 dictionary, suggests the nearest valid role via Levenshtein distance
- `aria/required-attrs` (wcag22:4.1.2) — flags ARIA roles missing their required state attributes (checkbox/aria-checked, slider/aria-valuenow, etc.)
- `aria/valid-attr` (wcag22:4.1.2) — flags aria-* attributes not in the WAI-ARIA 1.2 states/properties dictionary
- `contrast/minimum` (wcag22:1.4.3) — WCAG contrast ratio check via CSS parser, with large-text heuristic (≥18pt or ≥14pt bold)
- `document/iframe-title` (wcag22:4.1.2, 2.4.1) — flags iframe elements without a title or aria-label
- `document/lang-attribute` (wcag22:3.1.1) — flags HTML root without a lang attribute
- `document/meta-refresh` (wcag22:2.2.1, 2.2.4, 3.2.5) — flags meta http-equiv=refresh auto-redirects/reloads
- `document/page-titled` (wcag22:2.4.2) — flags documents without a meaningful `<title>`
- `document/viewport-zoom` (wcag22:1.4.4, 1.4.10) — flags `<meta viewport>` that disables pinch-to-zoom
- `focus/tabindex-positive` (wcag22:2.4.3) — flags positive tabindex values (focus-order anti-pattern)
- `forms/autocomplete-missing` (wcag22:1.3.5) — flags personal-info inputs without an autocomplete token
- `forms/fieldset-legend` (wcag22:1.3.1, 3.3.2) — flags fieldset without a legend (or aria-label substitute)
- `forms/label-for-id-mismatch` (wcag22:1.3.1) — flags label[for=X] where no element has id=X
- `forms/labels-required` (wcag22:1.3.1, 3.3.2, 4.1.2) — flags form controls without an accessible label
- `keyboard/accesskey-duplicate` (wcag22:2.1.1) — flags multiple elements sharing an accesskey value (case-insensitive)
- `keyboard/handler-missing` (wcag22:2.1.1) — flags clickable elements without a keyboard handler
- `media/alt-text-missing` (wcag22:1.1.1) — flags images without a text alternative, with filename-derived suggestions
- `media/autoplay-sound` (wcag22:1.4.2) — flags audio/video autoplay without muted or controls
- `media/video-captions-missing` (wcag22:1.2.2) — flags `<video>` without a `<track kind="captions">`
- `navigation/link-descriptive-text` (wcag22:2.4.4) — flags link text like "click here" / "read more"
- `navigation/link-no-href` (wcag22:2.1.1, 4.1.2) — flags `<a onClick>` without an href
- `parsing/duplicate-id` (wcag22:4.1.1 historical) — flags duplicate `id` attributes in a document
- `parsing/html-has-lang` (wcag22:3.1.2) — flags syntactically invalid BCP 47 lang values
- `semantics/button-name` (wcag22:4.1.2) — flags buttons without an accessible name
- `semantics/heading-hierarchy` (wcag22:1.3.1) — flags skipped heading levels and missing `<h1>`
- `semantics/list-structure` (wcag22:1.3.1) — flags `<li>` outside `<ul>/<ol>/<menu>` and list containers with non-`<li>` children
- `semantics/nested-interactive` (wcag22:4.1.2) — flags interactive elements nested in other interactive elements
- `semantics/table-headers` (wcag22:1.3.1) — flags data tables without `<th>` header cells

#### Parsers (zero-dep, in-house)
- TSX/JSX parser — character-driven, preserves PascalCase components, recognizes HTML5 void elements.
- HTML parser — HTML5-quirks-aware, explicit progress guarantees to prevent hangs on malformed input.
- CSS parser — rules, at-rules, nested `@media`/`@supports`/`@keyframes`, `!important`, comments, function calls.

#### Output formatters
- `terminal` — colored output, snippet rendering, coverage scorecard.
- `plain` — color-free terminal output for piping.
- `json` — machine-readable ScanResult + ReportData.
- `sarif` — SARIF 2.1.0 for GitHub code scanning.
- `junit` — JUnit XML for CI test-result UIs.
- `markdown` — PR-comment-friendly markdown report.

#### CLI
- `scan` command with `--standard`, `--level`, `--exclude`, `--fail-on`, `--format`, `--no-color`, `--verbose`, `--quiet`, `--debug`
- `--changed` — scan only git-staged files (precommit-friendly)
- `--since <ref>` — scan only files changed since a git ref
- `--baseline=create|check|update` — baseline mode with sha1 fingerprinting (line-number-independent)
- `--baseline-file=<path>` — override the default `.ra11y-baseline.json` path
- `--list-rules`, `--list-standards`, `--explain <ruleId>` — rule and standard introspection
- `--coverage`, `--checklist`, `--vpat`, `--certification` — report commands
- Exit codes: 0 clean, 1 violations, 2 errors, 3 new baseline violations

#### Configuration
- `ra11y.config.ts`, `.js`, `.mjs`, `.json` — config file loader walks up from cwd, stops at `.git`
- `--config <path>` / `RA11Y_CONFIG` environment variable to override auto-discovery
- Per-rule severity overrides (`"error" | "warning" | "info" | "off"`)
- Per-directory `overrides` array with last-match-wins precedence
- Inline disable pragmas: `ra11y-disable-next-line`, `ra11y-disable`/`ra11y-enable`
- Supported comment styles: `//`, `/* */`, `<!-- -->`, `{/* */}`
- Trailing `-- reason:` text parsed as a human note, not as more rule IDs

#### Plugin API
- `defineRule()`, `defineStandard()`, `defineFormatter()`, `defineConfig()` — typed identity helpers
- Plugin rule example: [`examples/plugin-rule/`](./examples/plugin-rule/)
- Plugin standard example: [`examples/plugin-standard/`](./examples/plugin-standard/)

#### Developer experience
- Precommit git hook: `.githooks/pre-commit` + `.githooks/commit-msg` (installed via `bun run setup`, which sets `core.hooksPath .githooks`)
- Conventional-commit enforcement via `scripts/check-commit.ts` (feat/fix/chore/docs/refactor/test/perf/build/ci, 72-char subject limit)
- Claude Code autonomous infrastructure: hooks, subagents, skills, backlog
- In-house utilities: ANSI coloring, contrast math, args parser, logger, glob matching, string width

#### Documentation
- [`docs/getting-started.md`](./docs/getting-started.md) — install, first scan, interpreting output, fixing a violation
- [`docs/cli.md`](./docs/cli.md) — full flag reference and exit-code table
- [`docs/configuration.md`](./docs/configuration.md) — config file spec, rule settings, per-directory overrides, precedence rules
- [`docs/architecture.md`](./docs/architecture.md) — three-layer model, equivalence closure, rule execution lifecycle, plugin boundaries
- [`docs/kb/patterns/writing-a-rule.md`](./docs/kb/patterns/writing-a-rule.md) — canonical rule-authoring workflow for agents
- [`docs/kb/architecture/rule-engine.md`](./docs/kb/architecture/rule-engine.md) — engine internals deep dive

### Target for v0.1.0

- First npm release (`npm publish --provenance`)
- Manual review checklist generator for non-automatable criteria (stub exists, needs data)
- Additional rule coverage beyond the current 29 (stretch — v0.1.0 target of 30 is effectively reached)
