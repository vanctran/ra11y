# CLAUDE.md — ra11y contributor guide

Source of truth for anyone (human or Claude Code) working on ra11y. What the project is, what invariants it must uphold, how to verify changes, where to look next. Read it all before making changes.

Detailed subsystems live in `@docs/` and `@docs/kb/` — this file is the index, not the textbook.

## 1. Project identity

**ra11y** is an **AI-first multi-standard accessibility scanner** for web projects. It parses JSX/TSX, HTML, and CSS with in-house zero-dependency parsers and runs a hybrid static-analysis + AST check against pluggable accessibility standards — WCAG 2.2/2.1, Section 508, EN 301 549 out of the box, with a plugin API for adding more.

Name: homophone of "rally" (a call to action for accessibility) with the `a11y` numeronym baked in. Binary: `ra11y`. npm package: `@ra11y/core` (the unscoped `ra11y` name is owned by a long-dormant package; scoped is our way in). License: MIT.

Design priorities — the things the project optimizes for, in roughly decreasing importance:

- **AI-first MCP server.** An agent-native tool surface — `scan_project` with inline `autoDetectWrappers` + `additionalPaths`, `checklist` with ranked review candidates, `suggest_fix` with primary/alternative fix paths, `detect_native_wrappers` for one-shot onboarding. Responses carry scan-confidence telemetry (opaque component counts, template-directive handling, CSS coverage ratios) so the agent knows when the scan had teeth. Canonical inventory: `tools/list` on the server.
- **Zero runtime dependencies.** Nothing in `dependencies`. Everything in-house. Tiny install, tiny supply-chain surface, appealing for a compliance tool.
- **Multi-standard architecture.** Standards → Criteria → Rules. One rule can satisfy WCAG 2.2, WCAG 2.1, Section 508, and EN 301 549 criteria simultaneously. Adding a new standard never touches rule code.
- **VPAT + certification scorecard.** `--vpat`, `--certification`, and `--checklist` produce VPAT-shaped output and a readiness scorecard — the thing teams actually need when pursuing WCAG certification.
- **Precommit-speed.** Sub-second on typical commits. Precommit-friendly. Performance budget enforced in CI.
- **Polish on the human-facing surfaces.** Beautiful terminal output, context-aware fix suggestions, multiple output formats, plugin API, deep rule metadata. Not the design center, but earned after the AI-first surface is honest.

**The AI-first consumer model is doctrine.** The primary consumer is an agent calling MCP tools, not a human reading a dashboard — several tooling defaults (suppression, priority downgrading, terse meta, labeled buckets, numeric thresholds, empty-sentinel fields, zero-output success, composite headline counts) invert under that framing. The full rules, with rationale and worked examples, live in `@docs/kb/architecture/ai-first-consumer.md`. They also load automatically via `.claude/rules/mcp-response-shapes.md` when editing code that shapes MCP tool responses (MCP handlers, reports, formatters, review candidates, plus the authoritative shape-owning files in `src/types/` and `src/engine/scanner.ts`). Treat those rules as load-bearing when triaging field reports or designing new surfaces.

## 2. Current stack

Pinned tool versions and spec references live in `@docs/stack.md`. Before upgrading any row, invoke `/research-latest <package>` and update that file with a new "as of" date.

## 3. Architectural invariants (NEVER violate)

These are non-negotiable. A PR that breaks any of them is rejected before review.

1. **`dependencies: {}` is empty.** Enforced by `scripts/check-zero-deps.ts` in CI. `peerDependencies` may contain `typescript` (optional, for TSX parsing via compiler API). `devDependencies` may contain TypeScript, Bun types, Biome, and narrow documentation tooling (typedoc, mermaid-cli, markdownlint-cli2). Nothing else.
2. **TypeScript only, Bun first.** Every file in `src/`, `tests/`, `scripts/`, and `.claude/hooks/` is `.ts`. No JS, no shell, no Python. Scripts run with `bun <file>.ts`.
3. **Node LTS compatible.** The shipped artifact must run on Node 22+. Do not use Bun-specific runtime APIs (`Bun.file`, `Bun.serve`, `Bun.SQL`, etc.) in `src/`. You may use them freely in `tests/`, `scripts/`, and `.claude/hooks/`.
4. **Every rule cites WCAG.** The rule file header cites the SC number(s) and spec URL. `satisfies` lists every criterion the rule checks across all loaded standards. Missing either is a CI failure.
5. **Every violation has a context-aware fix suggestion.** Not "add alt text" — "this `<img>` is inside a `<button>` with no label; alt should describe the button action."
6. **Rules are pure functions.** `(ctx: RuleContext) => Violation[]`. No I/O, no global state, no cross-rule dependencies. A rule that throws does not crash the scanner — it emits a synthetic `internal/rule-crash` violation and the scan continues.
7. **Standards are pure data.** A `Standard` object is a list of `Criterion` records with metadata. No behavior.
8. **Engine never imports from rules/standards.** It consumes them through registries. Formatters never import from rules/standards. They consume `ScanResult` and `ReportData`.
9. **Network isolation.** `src/` never references `fetch`, `node:http`, `node:https`, `node:net`, `node:dns`, or `Bun.fetch`. Enforced by `scripts/check-network-isolation.ts`. This is a compliance tool — users running it against proprietary source must trust it is offline.
10. **No `console.*`.** Use `src/utils/logger.ts`. Biome's `noConsole` blocks this; exceptions live in `.claude/hooks/` and `scripts/` (dev-time only).
11. **No `--no-verify`, no `git commit --amend` on pushed commits.** If a hook fails, fix the underlying issue. If you need a fix up, create a new commit.
12. **No magic numbers in `src/`.** Named constants only. `scripts/check-magic-numbers.ts` detects violations but is not wired into `verify` pending a cleanup pass on `src/rules/` and `src/review/finders/`; run it manually before landing changes in a fresh file. Tests are exempt.
13. **MCP response-shape discipline.** MCP tool responses, reports, and agent-facing formatters conform to the AI-first consumer model — no labeled-bucket or heuristic suppression, verbose `meta` stays, optional fields are present-when-meaningful, zero-output success carries a structured `warnings` code, composite headline counters split by kind. Full rules in `.claude/rules/mcp-response-shapes.md` and `@docs/kb/architecture/ai-first-consumer.md`.

## 4. Verification commands

Run in this order on any change. All must pass before committing.

```bash
bun run verify             # Single entrypoint — runs the full check sequence
bun run verify:precommit   # Same, but filtered to checks that gate commits
bun run test:coverage      # Coverage report (≥95% on engine/rules/standards/parsers/reports/utils)
bun run build              # Transpile src/ → dist/
```

`scripts/verify.ts` is the one place that names the check sequence (typecheck, typecheck-tests, lint, tests, zero-deps, network-isolation, limits, cycles, error-messages, tsdoc, mermaid, docs-links, kb-drift). CI, the pre-commit hook, and the `/verify` skill all call `bun run verify`. To run one check directly, invoke its script: `bun scripts/check-cycles.ts`. Don't add package.json aliases per-check.

## 5. Project layout

```
ra11y/
├── .claude/                 # Autonomous infrastructure
│   ├── settings.json        # Hook wiring
│   ├── backlog.md           # Persistent to-do list — /continue reads this
│   ├── agents/              # Subagent definitions
│   ├── skills/              # Skills (folders with SKILL.md + supporting files)
│   ├── rules/               # Path-scoped rules loaded on demand
│   └── hooks/               # TypeScript hook scripts run by bun
├── src/
│   ├── index.ts             # Public programmatic API entry (re-exports from src/api/)
│   ├── cli.ts               # Binary entry (thin wrapper over src/cli/)
│   ├── types/               # Single source of truth for shared types
│   ├── engine/              # Scanner machinery (scanner, rule-runner, registries)
│   ├── standards/           # WCAG 2.2, 2.1, Section 508, EN 301 549
│   ├── rules/               # Rules organized by domain
│   ├── input/               # Parsers (tsx, html, css, tailwind) + file discovery
│   ├── output/              # Formatters (terminal, json, sarif, junit, html, markdown, agent) + theme
│   │   └── agent-response/  # Shared AI-first response builder — consumed by MCP + CLI --format agent
│   ├── reports/             # Structured reports (coverage, vpat, certification, checklist)
│   ├── mcp/                 # MCP server (JSON-RPC over stdio) + tool handlers
│   │   ├── prompts/         # Built-in prompt templates (audit, fix, triage)
│   │   └── resources/       # ra11y-kb:// resource index + readers
│   ├── review/              # Review candidate ranking
│   │   └── finders/         # Per-criterion manual-review candidate generators
│   ├── config/              # Config loading + validation (ra11y.config.ts, pragmas)
│   ├── api/                 # Public API (defineRule, defineStandard, defineConfig, defineFormatter)
│   ├── cli/                 # CLI internals
│   │   └── commands/        # Per-command handlers (scan, coverage, vpat, checklist, …)
│   └── utils/               # Zero-dep primitives (ansi, args, glob, contrast, string-width, logger)
├── tests/                   # Mirrors src/; plus integration, snapshot, cli, fuzz, golden, fixtures
├── docs/                    # User docs + architecture + ADRs + indexed KB (docs/kb/)
├── examples/                # Precommit, CI, plugin examples
└── scripts/                 # All .ts, run with bun (guards, generators, bench)
```

## 6. The three-layer model

```
  Standards (WCAG 2.2, 2.1, Section 508, EN 301 549)
       ▲  declares
  Criteria (wcag22:1.4.3, section508:1194.22.c, en301549:9.1.4.3)
       ▲  satisfies: Criterion[]
  Rules (contrast/minimum, alt-text/missing, focus/visible)
```

Accessibility standards overlap massively. A contrast check satisfies WCAG 1.4.3 AA, Section 508 §1194.22(c), and EN 301 549 9.1.4.3. Separating *what to check* (rules) from *why it matters* (criteria) from *which framework cares* (standards) kills duplication. At registry init, the engine walks every loaded standard's `equivalentTo` field and builds a reciprocal index, so thin standards (Section 508, EN 301 549) get full coverage for free via equivalence.

Full walkthrough: `@docs/kb/architecture/three-layer-model.md` and `@docs/kb/architecture/rule-engine.md`.

## 7. Workflow shortcuts

Every common authoring workflow has a skill that orchestrates the full sequence. Invoke the skill first; fall back to manual steps only when the skill is inappropriate.

- `/add-rule <criterion-id>` — new rule from WCAG criterion (evaluator-optimizer: rule-implementer + a11y-reviewer)
- `/add-standard <id>` — new standard module
- `/add-formatter <name>` — new output formatter
- `/fix-drift` — regenerate auto-generated docs after rule/standard changes
- `/verify` — full preflight check sequence
- `/review` — code-reviewer + a11y-reviewer on a ref
- `/bench` — performance budget check
- `/release <version>` — version bump + changelog + tag + publish

Detailed procedures live in each skill's `SKILL.md` under `.claude/skills/`.

### Bug-fix workflow — real-world fixture first

When fixing a real-world bug rather than adding a new rule from spec, invert the default: land the sanitized repro **before** the fix, not alongside it.

1. Sanitize the failing case at `tests/fixtures/real-world/<case>/` (see ADR 0006 and the `fixture-curator` agent). `source/` tree + `assertions.ts` declaring the invariant the fix will restore.
2. Commit the failing fixture first: `test(real-world): add <case> fixture capturing <bug>`. Harness test should be **red** on this commit.
3. Fix in `src/`.
4. Commit the fix: `fix(<scope>): <what>`. Harness test now goes green.
5. Migrate any behavior-rehearsal unit tests — delete or narrow rather than duplicate (see § 14 common mistakes).

Fixtures survive refactors that reshape internal APIs; unit tests rehearsing the bug do not.

## 8. Autonomous development workflow

This repo is designed for autonomous Claude Code sessions. Specialist subagents, skills, and hooks are inventoried under `.claude/agents/`, `.claude/skills/`, `.claude/hooks/` — `ls` those directories for the current set.

Two patterns drive the work:

**Orchestrator-Workers.** Main session is always the orchestrator; subagents can't spawn subagents. `/continue` reads `.claude/backlog.md`, picks one item from each active track, and fans out up to 3 parallel Agent tool calls per turn. Hard rules: never two agents on the same track in one turn, never more than 3 concurrent, main-session inline work counts against the budget. Hard cap 10 turns per invocation.

**Evaluator-Optimizer.** `/add-rule` loops rule-implementer → a11y-reviewer (generator → critic against WCAG normative text). Max 3 iterations before reporting BLOCKED.

Never circumvent hooks. If a hook blocks you, fix the underlying problem.

## 9. Commit discipline (mandatory)

Every commit — whether you author it or a subagent does — follows these rules. They exist because autonomous runs must be debuggable, reviewable, and interruptible.

1. **One logical change per commit.** One new rule, one new standard criterion batch (≤20 criteria), one formatter, one concept doc, one hook script.
2. **≤400 lines net diff per commit.** Auto-generated files (kb regeneration) go in their own `chore(kb): regenerate …` commit. If a single logical unit legitimately exceeds 400 LOC, split it by concern (skeleton / logic / tests / fixtures) not by ritual.
3. **Commit before every verification.** Run `/verify` on committed state.
4. **Commit before delegating.** When `/add-rule` hands off from generator to reviewer, the generator commits first so the reviewer reviews real git state.
5. **Never amend a pushed commit.** Never `--no-verify`.
6. **Conventional commits** (enforced by `scripts/check-commit.ts`):
   - `feat(rules): add contrast/minimum for wcag22:1.4.3`
   - `test(rules): add contrast/minimum edge cases`
   - `fix(engine): standard-filter missed equivalentTo criteria`
   - `chore(kb): regenerate rule index`
   - `docs(kb): add wcag 1.4.3 knowledge base entry`
   - `refactor(engine): extract standard-filter from rule-runner`

A typical rule ships in **2 commits** (feat(rules) covering rule + tests + fixtures + registry, plus chore(kb) for the regenerated KB). The scaffolder (`bun scripts/scaffold-rule.ts`) eliminates the value of splitting skeleton/logic/tests/fixtures — they're produced together, verify at once, commit at once. Fall back to staged 4-5 commits only when a rule legitimately exceeds the 400-LOC cap.

## 10. Documentation is a deliverable

Docs are enforced, not optional. When you change behavior, update docs in the same PR. Agents retrieving knowledge read `docs/kb/`, not source.

- **Public API exports in `src/api/`** must have TSDoc with `@param`, `@returns`, `@example`. Enforced by `scripts/check-tsdoc.ts`.
- **Mermaid diagrams** ≤7 nodes, single-direction, labeled edges, preceded by prose. Enforced by `scripts/check-mermaid.ts`.
- **`docs/kb/`** is for agent retrieval. Every WCAG SC, every standard, every rule, every concept gets a dense, headed, ≤500-line markdown file with frontmatter. The three `generate-*-kb.ts` scripts regenerate the auto files; `check-kb-drift.ts` fails CI if generated files are stale.
- **ADRs** in `docs/adr/NNNN-title.md` are append-only; a reversed decision gets a new ADR marked `supersedes 00NN`.
- **Every change type has required doc updates** — see `docs/contributing/change-doc-matrix.md`.

## 11. Performance budget

Enforced in CI by `scripts/bench.ts`; history in `docs/performance.md`.

| Scenario | Budget |
|----------|--------|
| Cold start (spawn → first result) | ≤ 200 ms |
| 10 files, 1k LOC | ≤ 100 ms |
| 100 files, 10k LOC | ≤ 500 ms |
| 1000 files, 100k LOC | ≤ 3 s |

## 12. Semver policy

- **Patch** (0.1.x): bug fixes, refactors, docs, tightening detection on an existing rule.
- **Minor** (0.x.0): new rules, standards, formatters, CLI flags, plugin API additions, widening or loosening a rule's detection.
- **Major** (x.0.0): removing rules, renaming rule IDs without a deprecation alias, breaking `Rule`/`Standard`/`Config` shapes, CLI flag removal, exit code semantics change.

v0.x is rapid iteration — treat the plugin API as semi-stable until v1.0.

## 13. Release process

1. All v0.1.0 backlog items checked off.
2. `bun run verify` + `bun run build` green.
3. `scripts/generate-changelog.ts` walks git log from last tag and emits Keep-a-Changelog markdown for review.
4. `/release <version>` bumps `package.json`, commits, tags.
5. `release.yml` publishes to npm on tag push with `npm publish --provenance`.
6. GitHub release with changelog excerpt.

Rule coverage matrix for v0.1.0 lives in `@docs/kb/standards/wcag22.md` — every row marked "auto" or "partial" under WCAG 2.1 A+AA and 2.2 A+AA additions ships in v0.1.0. Manual-only criteria get a checklist entry in `src/reports/checklist.ts`.

## 14. Common mistakes

Mistakes specific to consumer-model / MCP response shape design live in `@docs/kb/architecture/ai-first-consumer.md` and the path-scoped rule at `.claude/rules/mcp-response-shapes.md`. This list covers the rest:

- Adding a dependency "just for this one thing." → implement in `src/utils/`.
- Generic fix suggestions. → inspect surrounding AST nodes and produce context-aware text.
- Touching engine code when adding a rule. → rules are content; the engine is stable.
- Patching a test to make it pass. → the WCAG spec is source of truth. Fix whichever is wrong.
- Using `Bun.file()` or similar in `src/`. → Node-compatible APIs only in `src/`. Bun-specific usage stays in tests/scripts/hooks.
- Skipping `/verify`. → precommit hooks catch it, but develop the habit.
- `// @ts-ignore`. → fix the type.
- Committing without a WCAG citation in the rule header. → CI rejects.
- Hardcoding inventory counts in docs ("49 rules", "four standards"). → these rot between releases. Name the items that matter or point at the canonical source (`tools/list`, `src/rules/index.ts`). Specific counts belong only in changelog entries, release notes, or generated reports where the date/version anchors them.
- Writing behavior-rehearsal unit tests for a real-world bug. → "the ranker orders alphabetically on ties", "the cap returns 5 entries when given 10" — these re-assert the code you just wrote and need to change every time you refactor; they catch typos, not regressions in behavior the user cares about. A test earns its keep when it encodes either (a) an invariant that survives refactors ("every pragma declaration has a line number") or (b) a real-world failure mode with a sanitized repro. For (b), **land the snippet under `tests/fixtures/real-world/<case>/` before writing the fix** (see § 7 bug-fix workflow). Fixtures survive internal rewrites; behavior-rehearsal unit tests for the same bug do not.

## 15. When in doubt

- WCAG interpretation: quote the spec normatively in the rule file and link to `https://www.w3.org/TR/WCAG22/#<sc-anchor>`.
- Design choice not covered here: prefer smallest code, clearest types, zero deps, spec-accurate, test-first.
- Stuck after 3 fix attempts on a rule: report "BLOCKED: <reason>" and stop.
- Anything auth / push / external / irreversible: confirm with the user before acting.

## 16. Contact points

- WCAG 2.2 spec: https://www.w3.org/TR/WCAG22/
- WCAG 2.1 spec: https://www.w3.org/TR/WCAG21/
- Architecture: `@docs/kb/architecture/` (three-layer-model, rule-engine, mcp-server, mcp-sampling, output-formatters, reports, registries, input-parsers, ai-first-consumer)
- Rule authoring guide: `@docs/kb/patterns/writing-a-rule.md`
- Standard authoring guide: `@docs/kb/patterns/writing-a-standard.md`
- Gotchas: `@docs/kb/gotchas/`

Ship something beautiful.
