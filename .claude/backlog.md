# ra11y backlog

The `/continue` skill reads this file, picks the next unchecked item, dispatches to a specialist subagent, verifies, commits, and checks off the item. Each item should be small enough that one specialist can finish it in under 20 minutes and 5–7 commits. When an item would produce more work, split it in place before dispatching.

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked (reason in comment)

---

## Phase 0 — Autonomous Claude Code infrastructure

- [x] Research Claude Code hooks / subagents / skills schemas against current docs
- [x] Research latest stable versions (TypeScript, Bun, Node LTS, Biome, WCAG status)
- [x] Scaffold directory structure
- [x] Root config files (package.json, tsconfig.json, biome.json, .gitignore, LICENSE, .editorconfig)
- [x] Top-level docs (CLAUDE.md, README.md, CONTRIBUTING.md, CHANGELOG.md, SECURITY.md, ACCESSIBILITY.md, CODE_OF_CONDUCT.md)
- [x] `.claude/settings.json` wiring all hooks
- [x] `.claude/hooks/lib/types.ts` — shared hook payload types
- [x] `.claude/hooks/lib/input.ts` — stdin JSON reader
- [x] `.claude/hooks/lib/output.ts` — stdout JSON writer + exit code helpers
- [x] `.claude/hooks/lib/audit.ts` — history.jsonl writer
- [x] `.claude/hooks/lib/project-state.ts` — shared state reader for session dashboard
- [x] `.claude/hooks/session-start.ts`
- [x] `.claude/hooks/user-prompt-submit.ts`
- [x] `.claude/hooks/pre-tool-use.ts`
- [x] `.claude/hooks/pre-commit.ts`
- [x] `.claude/hooks/post-edit.ts`
- [x] `.claude/hooks/post-tool-failure.ts`
- [x] `.claude/hooks/subagent-stop.ts`
- [x] `.claude/hooks/stop.ts`
- [x] `.claude/hooks/notification.ts`
- [x] `.claude/hooks/instructions-loaded.ts`
- [x] `.claude/notes/README.md`
- [x] `.claude/agents/rule-implementer.md`
- [x] `.claude/agents/standard-builder.md`
- [x] `.claude/agents/spec-researcher.md`
- [x] `.claude/agents/parser-author.md`
- [x] `.claude/agents/formatter-author.md`
- [x] `.claude/agents/fixture-generator.md`
- [x] `.claude/agents/test-author.md`
- [x] `.claude/agents/a11y-reviewer.md`
- [x] `.claude/agents/code-reviewer.md`
- [x] `.claude/agents/type-smith.md`
- [x] `.claude/agents/dependency-auditor.md`
- [x] `.claude/agents/doc-writer.md`
- [x] `.claude/agents/benchmark-tuner.md`
- [x] `.claude/agents/fixture-curator.md`
- [x] `.claude/agents/migration-author.md`
- [x] `.claude/agents/release-captain.md`
- [ ] `.claude/skills/continue/SKILL.md`
- [ ] `.claude/skills/verify/SKILL.md`
- [ ] `.claude/skills/add-rule/SKILL.md` + templates + gotchas.md
- [ ] `.claude/skills/add-standard/SKILL.md` + templates + gotchas.md
- [ ] `.claude/skills/add-formatter/SKILL.md` + templates + gotchas.md
- [ ] `.claude/skills/review/SKILL.md`
- [ ] `.claude/skills/fix-drift/SKILL.md`
- [ ] `.claude/skills/bench/SKILL.md`
- [ ] `.claude/skills/standards-audit/SKILL.md`
- [ ] `.claude/skills/session-state/SKILL.md`
- [ ] `.claude/skills/research-latest/SKILL.md`
- [ ] `.claude/skills/release/SKILL.md`
- [ ] `.claude/notes/README.md`

## Phase 1 — Guards and scaffolding scripts

- [ ] `scripts/check-zero-deps.ts`
- [ ] `scripts/check-limits.ts` (function size, file size, complexity, nesting)
- [ ] `scripts/check-cycles.ts` (tarjan's)
- [ ] `scripts/check-dead-exports.ts`
- [ ] `scripts/check-magic-numbers.ts`
- [ ] `scripts/check-commit.ts` (conventional commit validator)
- [ ] `scripts/check-network-isolation.ts`
- [ ] `scripts/check-error-messages.ts`
- [ ] `scripts/check-tsdoc.ts`
- [ ] `scripts/check-mermaid.ts`
- [ ] `scripts/check-docs-links.ts`
- [ ] `scripts/check-api-docs-drift.ts`
- [ ] `scripts/check-kb-drift.ts`
- [ ] `scripts/generate-wcag-kb.ts`
- [ ] `scripts/generate-rule-kb.ts`
- [ ] `scripts/generate-kb-index.ts`
- [ ] `scripts/generate-changelog.ts`
- [ ] `scripts/build.ts` (bun-driven build)
- [ ] `scripts/bench.ts`

## Phase 2 — Core types and registries

- [ ] `src/types/standard.ts` (Standard, Criterion)
- [ ] `src/types/rule.ts` (Rule, RuleContext, Severity, Fix)
- [ ] `src/types/violation.ts` (Violation, Location, ScanResult)
- [ ] `src/types/config.ts` (Config, LoadedConfig)
- [ ] `src/types/ast.ts` (parser AST node types)
- [ ] `src/types/index.ts` (barrel)
- [ ] `src/engine/registry/standards.ts`
- [ ] `src/engine/registry/criteria.ts`
- [ ] `src/engine/registry/rules.ts`
- [ ] `src/engine/standard-filter.ts`
- [ ] `src/engine/context-builder.ts`
- [ ] `src/engine/rule-runner.ts`
- [ ] `src/engine/scanner.ts`
- [ ] `src/engine/ast-helpers.ts`
- [ ] `src/api/plugin.ts` (defineRule, defineStandard, defineFormatter, defineConfig)
- [ ] `src/api/index.ts`
- [ ] Tests for every file above

## Phase 3 — WCAG 2.2 standard module

- [ ] `src/standards/wcag22/metadata.ts`
- [ ] `src/standards/wcag22/criteria.ts` (all 86 criteria)
- [ ] `src/standards/wcag22/standard.ts`
- [ ] `tests/unit/standards/wcag22.test.ts` (golden-file counts, levels, URLs)

## Phase 4 — In-house utilities

- [ ] `src/utils/logger.ts`
- [ ] `src/utils/assert.ts`
- [ ] `src/utils/fs.ts`
- [ ] `src/utils/path.ts`
- [ ] `src/utils/glob.ts`
- [ ] `src/utils/git.ts`
- [ ] `src/utils/ansi.ts`
- [ ] `src/utils/string-width.ts`
- [ ] `src/utils/wrap.ts`
- [ ] `src/utils/color.ts`
- [ ] `src/utils/contrast.ts` (WCAG relative luminance + ratio)
- [ ] `src/utils/index.ts` (barrel)
- [ ] `src/cli/args.ts` (in-house argument parser)
- [ ] Tests for every utility

## Phase 5 — Parsers

- [ ] `src/input/parsers/tsx.ts`
- [ ] `src/input/parsers/html.ts`
- [ ] `src/input/parsers/css.ts`
- [ ] `src/input/parsers/tailwind.ts`
- [ ] `src/input/resolvers/theme.ts`
- [ ] `src/input/discover.ts`
- [ ] `src/input/index.ts`
- [ ] Unit tests for every parser
- [ ] Fuzz tests for html and css parsers

## Phase 6 — Rule engine and first five rules

- [ ] Finalize rule engine lifecycle (beforeFile → node walk → afterFile → afterProject)
- [ ] `src/rules/media/alt-text-missing.ts` + tests + fixtures
- [ ] `src/rules/contrast/minimum.ts` + tests + fixtures
- [ ] `src/rules/navigation/link-descriptive-text.ts` + tests + fixtures
- [ ] `src/rules/focus/visible.ts` + tests + fixtures
- [ ] `src/rules/parsing/duplicate-id.ts` + tests + fixtures
- [ ] `src/rules/index.ts` registry barrel

## Phase 7 — Scanner + terminal formatter

- [ ] `src/output/theme/ansi.ts`
- [ ] `src/output/theme/symbols.ts`
- [ ] `src/output/theme/layout.ts`
- [ ] `src/output/formatters/terminal.ts`
- [ ] Integration test: `tests/integration/wcag22-scan.test.ts`

## Phase 8 — CLI

- [ ] `src/cli/run.ts`
- [ ] `src/cli/help.ts`
- [ ] `src/cli/commands/scan.ts`
- [ ] `src/cli/commands/list-rules.ts`
- [ ] `src/cli/commands/list-standards.ts`
- [ ] `src/cli/commands/explain.ts`
- [ ] `src/cli/commands/init.ts`
- [ ] `src/cli/commands/coverage.ts`
- [ ] `src/cli/commands/checklist.ts`
- [ ] `src/cli/commands/vpat.ts`
- [ ] `src/cli/commands/certification.ts`
- [ ] `src/cli/commands/doctor.ts`
- [ ] `src/cli.ts` binary entry
- [ ] `tests/cli/*` end-to-end spawned tests

## Phase 9 — WCAG 2.1 standard (architectural validation)

- [ ] `src/standards/wcag21/{metadata,criteria,standard}.ts`
- [ ] `tests/unit/standards/wcag21.test.ts`
- [ ] Verify `--standard wcag21` reuses existing rules via equivalentTo

## Phase 10 — Section 508 + EN 301 549 (thin via equivalentTo)

- [ ] `src/standards/section508/{metadata,criteria,standard}.ts`
- [ ] `src/standards/en301549/{metadata,criteria,standard}.ts`
- [ ] `tests/integration/equivalence-mapping.test.ts`

## Phase 11 — Remaining rules (~25 more)

One rule per backlog line. Grouped by domain:

- [ ] contrast/enhanced (1.4.6)
- [ ] contrast/non-text (1.4.11)
- [ ] focus/positive-tabindex (2.4.3)
- [ ] focus/not-obscured (2.4.11 WCAG 2.2)
- [ ] keyboard/handler-missing (2.1.1)
- [ ] keyboard/character-shortcuts (2.1.4)
- [ ] aria/valid-role (4.1.2)
- [ ] aria/valid-attrs (4.1.1)
- [ ] aria/name-role-value (4.1.2)
- [ ] aria/label-in-name (2.5.3)
- [ ] aria/live-region (4.1.3)
- [ ] semantics/heading-hierarchy (1.3.1 — document scope)
- [ ] semantics/headings-non-empty (2.4.6)
- [ ] semantics/landmark-roles (1.3.1)
- [ ] forms/labels-required (3.3.2)
- [ ] forms/non-empty-label (2.4.6)
- [ ] forms/autocomplete-attribute (1.3.5)
- [ ] media/captions-track (1.2.2)
- [ ] media/autoplay-control (1.4.2)
- [ ] motion/prefers-reduce (2.2.2 / 2.3.3)
- [ ] pointer/cancellation (2.5.2)
- [ ] pointer/drag-alternative (2.5.7 WCAG 2.2)
- [ ] pointer/target-size (2.5.8 WCAG 2.2)
- [ ] navigation/skip-link (2.4.1)
- [ ] layout/reflow-hardcoded-width (1.4.10)
- [ ] layout/text-spacing (1.4.12)
- [ ] tooltip/dismissable (1.4.13)
- [ ] orientation/unrestricted (1.3.4)
- [ ] parsing/valid-html (4.1.1)
- [ ] document/page-titled (2.4.2)
- [ ] document/lang-attribute (3.1.1)
- [ ] document/lang-on-parts (3.1.2)

## Phase 12 — Alternative formatters

- [ ] `src/output/formatters/json.ts` + snapshot tests
- [ ] `src/output/formatters/sarif.ts` + snapshot tests (validate against SARIF 2.1.0 schema)
- [ ] `src/output/formatters/junit.ts` + snapshot tests
- [ ] `src/output/formatters/html.ts` + snapshot tests
- [ ] `src/output/formatters/markdown.ts` + snapshot tests
- [ ] `src/output/formatters/plain.ts` (accessible baseline)

## Phase 13 — Reports

- [ ] `src/reports/coverage.ts` + tests
- [ ] `src/reports/checklist.ts` + tests
- [ ] `src/reports/vpat.ts` + tests
- [ ] `src/reports/certification.ts` + tests

## Phase 14 — Config, inline disables, baseline mode

- [ ] `src/config/defaults.ts`
- [ ] `src/config/define.ts`
- [ ] `src/config/loader.ts`
- [ ] Inline disable parser (`ra11y-disable-next-line`, `ra11y-disable`/`ra11y-enable`)
- [ ] Baseline mode: create / check / update / compare
- [ ] Monorepo `projects: []` support
- [ ] Config precedence tests (CLI > env > file > defaults)

## Phase 15 — Plugin API + example plugins

- [ ] Finalize `defineStandard`, `defineRule`, `defineFormatter`, `defineConfig`
- [ ] `examples/plugin-rule/` with package.json + test script
- [ ] `examples/plugin-standard/` with package.json + test script
- [ ] CI job that links both examples and runs their test scripts

## Phase 16 — Long-form documentation

- [ ] `docs/getting-started.md`
- [ ] `docs/cli.md`
- [ ] `docs/configuration.md`
- [ ] `docs/architecture.md`
- [ ] `docs/kb/architecture/three-layer-model.md`
- [ ] `docs/kb/architecture/rule-engine.md`
- [ ] `docs/kb/architecture/registries.md`
- [ ] `docs/kb/architecture/input-parsers.md`
- [ ] `docs/kb/architecture/output-formatters.md`
- [ ] `docs/kb/architecture/reports.md`
- [ ] `docs/kb/patterns/writing-a-rule.md`
- [ ] `docs/kb/patterns/writing-a-standard.md`
- [ ] `docs/kb/patterns/writing-a-formatter.md`
- [ ] `docs/kb/patterns/writing-a-test.md`
- [ ] `docs/kb/patterns/using-ast-helpers.md`
- [ ] `docs/kb/patterns/adding-a-fixture.md`
- [ ] `docs/kb/patterns/evaluator-optimizer-loop.md`
- [ ] `docs/kb/concepts/accessible-name-computation.md`
- [ ] `docs/kb/concepts/interactive-elements.md`
- [ ] `docs/kb/concepts/focus-visible-semantics.md`
- [ ] `docs/kb/concepts/tailwind-class-resolution.md`
- [ ] `docs/kb/concepts/wcag-contrast-formula.md`
- [ ] `docs/kb/concepts/aria-valid-roles.md`
- [ ] `docs/kb/gotchas/biome-quirks.md`
- [ ] `docs/kb/gotchas/bun-vs-node-differences.md`
- [ ] `docs/kb/gotchas/typescript-compiler-gotchas.md`
- [ ] `docs/kb/gotchas/wcag-edge-cases.md`
- [ ] `docs/kb/gotchas/test-flakiness.md`
- [ ] `docs/kb/glossary.md`
- [ ] `docs/certification/vpat-mapping.md`
- [ ] `docs/certification/readiness-scoring.md`
- [ ] `docs/certification/wcag-certification-guide.md`
- [ ] `docs/plugins/authoring-a-rule.md`
- [ ] `docs/plugins/authoring-a-standard.md`
- [ ] `docs/plugins/authoring-a-formatter.md`
- [ ] `docs/adr/0001-zero-runtime-dependencies.md`
- [ ] `docs/adr/0002-three-layer-standards-criteria-rules.md`
- [ ] `docs/adr/0003-typescript-peer-for-tsx-parsing.md`
- [ ] `docs/adr/0004-bun-test-over-vitest.md`

## Phase 17 — CI workflows

- [ ] `.github/workflows/ci.yml` (matrix: Node 22/24 × Bun 1.3 × {ubuntu,macos,windows})
- [ ] `.github/workflows/release.yml` (npm publish --provenance on tag)
- [ ] `.github/ISSUE_TEMPLATE/bug_report.md`
- [ ] `.github/ISSUE_TEMPLATE/rule_request.md`
- [ ] `.github/ISSUE_TEMPLATE/standard_request.md`
- [ ] `.github/PULL_REQUEST_TEMPLATE.md`
- [ ] Dependabot config for devDependencies

## Phase 18 — Polish and v0.1.0

- [ ] README with real output snapshots
- [ ] asciinema demo recording
- [ ] Version bump to 0.1.0
- [ ] First npm publish
- [ ] GitHub release with changelog excerpt
