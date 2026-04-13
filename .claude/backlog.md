# ra11y backlog

The `/continue` skill reads this file, picks the next unchecked item, dispatches to a specialist subagent, verifies, commits, and checks off the item. Each item should be small enough that one specialist can finish it in under 20 minutes and 5–7 commits. When an item would produce more work, split it in place before dispatching.

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked (reason in comment)

---

## Phase 0 — Autonomous Claude Code infrastructure  ✅ COMPLETE

Hooks, agents, skills, settings — all 50 items landed. Do not modify without updating this phase.

## Phase 1 — Guards and scaffolding scripts  ✅ COMPLETE

All guard + generator scripts shipped. `scripts/verify.ts` is the single entrypoint (parallel execution, ordered output). Advisory-only: check-dead-exports, check-magic-numbers, check-docs-links, check-api-docs-drift.

## Phase 2 — Core types and registries  ✅ COMPLETE

Types, registries, scanner skeleton, AST helpers, and public API surface are all in place.

## Phase 3 — WCAG 2.2 standard module  ✅ COMPLETE

86 active criteria + historical 4.1.1; golden tests green.

## Phase 4 — In-house utilities

- [x] `src/utils/logger.ts`
- [x] `src/utils/assert.ts`
- [x] `src/utils/fs.ts`
- [x] `src/utils/path.ts`
- [x] `src/utils/glob.ts`
- [x] `src/utils/git.ts`
- [x] `src/utils/ansi.ts`
- [x] `src/utils/string-width.ts`
- [x] `src/utils/wrap.ts` + tests
- [x] `src/utils/color.ts`
- [x] `src/utils/contrast.ts`
- [x] `src/utils/args.ts`
- [x] `src/utils/index.ts`

## Phase 5 — Parsers

- [x] `src/input/parsers/tsx.ts`
- [x] `src/input/parsers/html.ts`
- [x] `src/input/parsers/css.ts`
- [ ] `src/input/parsers/tailwind.ts` (class extraction + arbitrary value resolution)
- [ ] `src/input/resolvers/theme.ts` (resolve tailwind theme tokens → concrete values)
- [x] `src/input/discover.ts`
- [x] `src/input/index.ts`
- [x] Unit tests for html, tsx, css parsers
- [ ] Fuzz tests for html and css parsers

## Phase 6 — Rule engine and first five rules  ✅ COMPLETE

Initial 5 rules (`alt-text-missing`, `contrast/minimum`, `link-descriptive-text`, `focus/outline-visible`, `parsing/duplicate-id`) all shipped. Engine lifecycle finalized.

## Phase 7 — Scanner + default formatters  ✅ COMPLETE

Terminal + plain + JSON formatters + theme + snapshot tests.

## Phase 8 — CLI

- [x] `src/cli.ts`, `src/cli/run.ts`, `src/cli/args.ts`, `src/cli/help.ts`
- [x] `src/cli/commands/scan.ts`
- [x] `src/cli/commands/list-rules.ts`
- [x] `src/cli/commands/list-standards.ts`
- [x] `src/cli/commands/explain.ts`
- [x] `src/cli/commands/coverage.ts`
- [x] `src/cli/commands/checklist.ts`
- [x] `src/cli/commands/vpat.ts`
- [x] `src/cli/commands/certification.ts`
- [x] `src/cli/commands/init.ts` (scaffolds `ra11y.config.ts`)
- [x] `src/cli/commands/doctor.ts` (env + config sanity check)
- [x] `tests/cli/cli.test.ts`

## Phase 9 — WCAG 2.1 standard  ✅ COMPLETE

wcag21/ module shipped; `--standard wcag21` reuses existing rules via equivalentTo.

## Phase 10 — Section 508 + EN 301 549  ✅ COMPLETE

Both standards shipped as thin `equivalentTo` data. Integration tests pending in Phase 18 polish.

## Phase 11 — Remaining rules

36 rules shipped (see `src/rules/index.ts`). The rules below still need implementation.

- [ ] contrast/enhanced (1.4.6 AAA)
- [ ] contrast/non-text (1.4.11 AA)
- [ ] focus/not-obscured (2.4.11 WCAG 2.2 AA)
- [ ] keyboard/character-shortcuts (2.1.4)
- [ ] aria/live-region-valid (4.1.3)
- [ ] semantics/landmark-roles (1.3.1)
- [ ] forms/non-empty-label (2.4.6)
- [ ] pointer/drag-alternative (2.5.7 WCAG 2.2)
- [ ] pointer/target-size (2.5.8 WCAG 2.2)
- [ ] navigation/skip-link (2.4.1)
- [ ] layout/reflow-hardcoded-width (1.4.10)
- [ ] tooltip/dismissable (1.4.13)
- [ ] document/lang-on-parts (3.1.2)

## Phase 12 — Alternative formatters  ✅ COMPLETE

terminal, plain, json, sarif, junit, markdown, agent — all shipped.

- [ ] `src/output/formatters/html.ts` + snapshot tests (the one remaining format for richly-viewable CI artifacts)

## Phase 13 — Reports  ✅ COMPLETE

coverage, checklist, vpat, certification all shipped with tests.

## Phase 14 — Config, inline disables, baseline mode

- [x] `src/config/defaults.ts`
- [x] `src/config/define.ts`
- [x] `src/config/loader.ts`
- [x] Inline disable parser
- [ ] Baseline mode: create / check / update / compare (`src/engine/baseline.ts` exists — wire the CLI flags + tests)
- [ ] Monorepo `projects: []` support in loader
- [ ] Config precedence tests (CLI > env > file > defaults)

## Phase 15 — Plugin API + example plugins

- [x] `defineRule`, `defineStandard`, `defineFormatter`, `defineConfig`
- [ ] `examples/plugin-rule/` with package.json + test script
- [ ] `examples/plugin-standard/` with package.json + test script
- [ ] `examples/plugin-formatter/` with package.json + test script
- [ ] CI job that links all three examples and runs their test scripts

## Phase 16 — Long-form documentation

User-facing guides + architecture KB + authoring guides + ADRs. These are all stubs in `docs/` today.

- [ ] `docs/getting-started.md` — expand beyond stub
- [ ] `docs/cli.md`
- [ ] `docs/configuration.md`
- [ ] `docs/architecture.md`
- [ ] `docs/kb/architecture/three-layer-model.md`
- [ ] `docs/kb/architecture/rule-engine.md`
- [ ] `docs/kb/architecture/registries.md`
- [ ] `docs/kb/architecture/input-parsers.md`
- [ ] `docs/kb/architecture/output-formatters.md`
- [ ] `docs/kb/architecture/reports.md`
- [ ] `docs/kb/architecture/mcp-server.md`  ← **new for MCP**
- [ ] `docs/kb/patterns/writing-a-rule.md`
- [ ] `docs/kb/patterns/writing-a-standard.md`
- [ ] `docs/kb/patterns/writing-a-formatter.md`
- [ ] `docs/kb/patterns/writing-a-test.md`
- [ ] `docs/kb/patterns/using-ast-helpers.md`
- [ ] `docs/kb/patterns/adding-a-fixture.md`
- [ ] `docs/kb/patterns/evaluator-optimizer-loop.md`
- [ ] `docs/kb/patterns/using-mcp-from-agents.md`  ← **new for MCP**
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
- [ ] `docs/mcp/server-setup.md`  ← **new for MCP**
- [ ] `docs/mcp/tool-reference.md`  ← **new for MCP**
- [ ] `docs/adr/0001-zero-runtime-dependencies.md`
- [ ] `docs/adr/0002-three-layer-standards-criteria-rules.md`
- [ ] `docs/adr/0003-typescript-peer-for-tsx-parsing.md`
- [ ] `docs/adr/0004-bun-test-over-vitest.md`
- [ ] `docs/adr/0005-in-house-mcp-server.md`  ← **new for MCP**

## Phase 17 — CI workflows

- [x] `.github/workflows/ci.yml`
- [x] `.github/workflows/release.yml`
- [x] `.github/ISSUE_TEMPLATE/bug_report.md`
- [x] `.github/ISSUE_TEMPLATE/rule_request.md`
- [x] `.github/ISSUE_TEMPLATE/standard_request.md`
- [x] `.github/PULL_REQUEST_TEMPLATE.md`
- [x] `.github/dependabot.yml`

## Phase 18 — Polish and v0.1.0

- [ ] README with real output snapshots (Mermaid diagram, `--mcp` demo, badges)
- [ ] asciinema demo recording
- [ ] `tests/integration/equivalence-mapping.test.ts` (cross-standard reuse)
- [ ] `tests/integration/mcp-session.test.ts` coverage audit
- [ ] Version bump to 0.1.0
- [ ] First npm publish
- [ ] GitHub release with changelog excerpt

---

## Phase 19 — MCP server (Phase 1 complete, ongoing hardening)  ✅ SHIPPED

Status per `.claude/notes/mcp-iteration.md`: 10 tools live, verified on a 329-file real project, sub-second scans. **This is our moat.** See settled-decisions list in the notes before changing anything in `src/mcp/`.

Completed (do not regress):
- [x] In-house JSON-RPC 2.0 server (zero-dep; ~200 lines in `src/mcp/server.ts`)
- [x] Session state + AST cache by mtime
- [x] Tools: `scan`, `scan_project`, `scan_file`, `detect_native_wrappers`, `explain_rule`, `suggest_fix`, `coverage`, `checklist`, `list_rules`, `configure`
- [x] `scan_project` auto-promotes to git root; `changedOnly`/`since` for CI-on-diff
- [x] `nativeWrappers` session config (quiets keyboard/handler-missing noise on React native-element wrappers)
- [x] `.mcp.json` at repo root for Claude Code auto-attach
- [x] Integration tests (spawn server as subprocess, drive JSON-RPC)
- [x] `unusedNativeWrappers` + `manualReviewRequired` + iterative-scan tip
- [x] Session/file wrapper split + WCAG titles on coverage

Hardening / polish still open:
- [ ] `src/mcp/tool-baseline.ts` — tools to create/check/update a baseline from within an MCP session (pairs with Phase 14 baseline work)
- [ ] `src/mcp/tool-scan-diff.ts` — compare current scan vs a baseline or previous result; emit only new findings (matches the `changedOnly` mental model but structural)
- [ ] `src/mcp/tool-explain-standard.ts` — return standard metadata + criterion list formatted for an agent (today's `list_rules` is rule-centric)
- [ ] `src/mcp/tool-review-candidates.ts` — surface tier-1 manual-review candidates with source context chunks so an LLM caller can answer pass/fail
- [ ] `src/mcp/tool-apply-fix.ts` — take a `suggest_fix` result, apply the search/replace, re-scan automatically, return the delta (kept disabled by default behind a `--allow-write` session flag — opt-in destructive)
- [ ] Prompt templates under `src/mcp/prompts/` — reusable `prompts/list` entries for common agent workflows (triage, fix, audit, VPAT narrative)
- [ ] `resources/list` support — expose `docs/kb/**` as MCP resources so attached agents can retrieve KB entries without filesystem tools
- [ ] Capability declaration polish: `logging`, `completions` where meaningful, `roots` so the server respects the host's project boundaries
- [ ] Structured errors: replace text-only error payloads with `structuredContent` where the tool result is machine-consumable (coverage, checklist, list_rules)
- [ ] `tests/integration/mcp-resources.test.ts` covering resources/list + resources/read round-trip
- [ ] `tests/integration/mcp-prompts.test.ts` covering prompts/list + prompts/get round-trip

## Phase 20 — Agent workflow (`ra11y --fix`, v0.2.0)

The turnkey version of the MCP workflow: one command, deterministic pipeline, no agent-loop hallucinations. `src/agent/` is the only part of `src/` allowed to use `fetch` (gated by an explicit carve-out in `scripts/check-network-isolation.ts`).

- [ ] `scripts/check-network-isolation.ts` — carve out `src/agent/**` as the only allowed `fetch` caller, document in the script header
- [ ] `src/agent/llm.ts` — thin Anthropic API client (fetch-based, no SDK); reads `RA11Y_API_KEY` / `ANTHROPIC_API_KEY`; prompt-caching enabled
- [ ] `src/agent/triage.ts` — given a scan result, classify findings into (auto-fixable, needs-source-read, needs-review, false-positive-candidate)
- [ ] `src/agent/component-resolver.ts` — for findings on PascalCase elements, follow the import and read the component source; verify if it wraps a native element
- [ ] `src/agent/fixer.ts` — apply or suggest fixes based on rule's `suggest_fix` plus LLM augmentation
- [ ] `src/agent/reviewer.ts` — for tier-1 review candidates, ask the LLM to answer pass/fail with the candidate's own `evaluation` prompt
- [ ] `src/agent/verifier.ts` — re-scan after fixes to confirm no regressions
- [ ] `src/agent/workflow.ts` — orchestrates scan → triage → resolve → verify → report
- [ ] `src/agent/reporter.ts` — summary output (fixed / false-positives / manual pass / manual fail)
- [ ] CLI: `ra11y --fix <paths>` wiring in `src/cli/args.ts` + `src/cli/commands/fix.ts`
- [ ] `src/cli/commands/review.ts` — run ONLY the manual-review pass (no fixes) for teams that want audit-only
- [ ] Deterministic prompt library under `src/agent/prompts/` — version-pinned strings, checksummed, loaded lazily
- [ ] `tests/unit/agent/*` — mock LLM responses; no real network
- [ ] `tests/integration/agent-fix.test.ts` — runs against fixtures/bad; uses a fake LLM that returns canned responses
- [ ] Docs: `docs/agent/workflow.md`, `docs/agent/configuration.md`, `docs/agent/prompt-library.md`

## Phase 21 — MCP + Agent polish (v0.2.x moat-deepening)

Items that turn "it works" into "it's the obvious choice for agentic a11y work."

- [ ] `ra11y.config.ts` schema for agent defaults (model, max tokens, redaction rules for source snippets)
- [ ] Telemetry opt-in: anonymous usage pings for agent workflow success/failure rates (strictly opt-in, documented in SECURITY.md)
- [ ] `src/mcp/sampling.ts` — implement MCP sampling so the server can ask the host agent for LLM completions, enabling LLM-backed review without the server owning an API key
- [ ] `/audit` skill — end-to-end: run scan, run agent review, produce a VPAT draft, output markdown report
- [ ] Prompt evals harness in `tests/evals/` — measure the prompt library's accuracy against a labeled fixture set, CI-gated
- [ ] `examples/ra11y-in-ci-with-agent/` — reference repo layout showing scan-only in CI + `--fix` in a labeled PR workflow
- [ ] VS Code extension skeleton under `integrations/vscode/` (out-of-tree but linked from README) — wraps the MCP server for IDE-native findings
- [ ] Public benchmark: `benchmarks/a11y-tool-comparison.md` vs axe-core + jsx-a11y against a labeled fixture set, published on releases
