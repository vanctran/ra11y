# CLAUDE.md — ra11y contributor guide

This file is the source of truth for anyone (human or Claude Code) working on ra11y. It tells you what the project is, what invariants it must uphold, how to verify changes, how to add rules and standards, and where to look next. Read it all before making changes.

## 1. Project identity

**ra11y** is a multi-standard accessibility scanner for web projects. It parses JSX/TSX, HTML, and CSS with in-house zero-dependency parsers and runs a hybrid static-analysis + AST check against pluggable accessibility standards — WCAG 2.2/2.1, Section 508, EN 301 549 out of the box, with a plugin API for adding more.

Name: homophone of "rally" (a call to action for accessibility) with the `a11y` numeronym baked in. Binary: `ra11y`. npm package: `@ra11y/core` (the unscoped `ra11y` name is owned by a long-dormant package; scoped is our way in). License: MIT.

What makes ra11y different from axe-core / eslint-plugin-jsx-a11y / Pa11y:

- **Zero runtime dependencies.** Nothing in `dependencies`. Everything in-house. Tiny install, tiny supply-chain surface, appealing for a compliance tool.
- **Multi-standard architecture.** Standards → Criteria → Rules. One rule can satisfy WCAG 2.2, WCAG 2.1, Section 508, and EN 301 549 criteria simultaneously. Adding a new standard never touches rule code.
- **Certification moat.** `--vpat`, `--certification`, and `--checklist` produce VPAT-shaped output and a readiness scorecard — the thing teams actually need when pursuing WCAG certification.
- **Fast.** Sub-second on typical commits. Precommit-friendly. Performance budget enforced in CI.
- **Elite DX.** Beautiful terminal output, context-aware fix suggestions, six output formats, plugin API, deep rule metadata.

### Consumer model: AI-first

ra11y's primary consumer is an AI agent calling the MCP tools — not a human reading a dashboard. CLI and formatters exist, but the design center is the agent. Several common tooling defaults invert under this assumption; treat the following as load-bearing when triaging field reports or designing new surfaces:

- **Surface, don't suppress.** Agents read every candidate in milliseconds; reviewer fatigue isn't the constraint a human-facing tool optimizes around. False positives a human would tune out are cheap for an agent to dismiss with one file read. Suppression discards signal the agent would use to triage. Default to surfacing with enough context for the agent to investigate.
- **Don't downgrade priority to hide things.** "Mark as low priority" is a UX lever for human attention budgets. Agents don't have one — they just sort. Surface honestly and let the agent rank by criterion + reason + context.
- **Verbose meta is signal, not clutter.** `configSource`, `configSearchedFrom`, `activeNativeWrappers`, `rulesEvaluated`, per-extension file counts — these are scan-confidence telemetry the agent actively uses to decide whether the scan had teeth and what to call next. Don't trim them to look terse.
- **Review *candidates*, not assertions.** For manual criteria, return locations + a short `reason` that frames the question. Don't try to be smart about "what the user really meant" — agents are better at that than heuristics.
- **One tool call should answer "what next?"** Each response carries `nextStep` hints, criterion IDs, and counts that match the other tools' counts. Cross-surface drift (`scan` says 21, `checklist` says 4) forces wasted round trips; invariants like the manual-review-count test exist to prevent this.

When a field report suggests "reduce noise," ask first: noise for whom? If the answer is "a human reviewer," the answer is usually no — the agent is the consumer and it wants the signal.

## 2. Current stack (as of 2026-04-11)

| Tool           | Version   | Source                                                                   |
|----------------|-----------|--------------------------------------------------------------------------|
| TypeScript     | 6.0.x     | https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/     |
| Bun            | 1.3.11    | https://github.com/oven-sh/bun/releases                                  |
| Node LTS       | 24.x (active), 22.x (maintenance) | https://nodejs.org/en/about/previous-releases  |
| Biome          | 2.4.11    | https://www.npmjs.com/package/@biomejs/biome                             |
| WCAG           | 2.2 (W3C Rec, 2023-10-05; update 2024-12-12; ISO/IEC 40500:2025) | https://www.w3.org/TR/WCAG22/ |
| WCAG           | 2.1 (W3C Rec, still referenced by many legal frameworks) | https://www.w3.org/TR/WCAG21/ |
| Section 508    | 2017 refresh (references WCAG 2.0) | https://www.access-board.gov/ict/        |
| EN 301 549     | v3.2.1 (references WCAG 2.1) | https://www.etsi.org/deliver/etsi_en/301500_301599/301549/ |
| SARIF          | 2.1.0     | https://docs.oasis-open.org/sarif/sarif/v2.1.0/                          |

**Never assume a version from memory.** Before upgrading, invoke `/research-latest <package>` and update this table with a new "as of" date.

TypeScript 6.0 is the **last release on the current JS codebase**; TypeScript 7 will be the Go rewrite. Treat 6.0 as stable; hold off on 7 until its ecosystem settles. We target TS 6.0 as the peer and devDependency, but the scanner's public API must remain callable from any TS ≥5.4 consumer (per `peerDependencies`).

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
12. **No magic numbers in `src/`.** Named constants only. Enforced by `scripts/check-magic-numbers.ts`. Tests are exempt.

## 4. Verification commands

Run in this order on any change. All must pass before committing.

```bash
bun run verify             # Single entrypoint — runs the full check sequence
bun run verify:precommit   # Same, but filtered to checks that gate commits
bun run test:coverage      # Coverage report (≥95% on engine/rules/standards/parsers/reports/utils)
bun run build              # Transpile src/ → dist/
```

`scripts/verify.ts` is the one place that names the check sequence (typecheck, lint, tests, zero-deps, network-isolation, limits, cycles, error-messages, tsdoc, mermaid, kb-drift). CI, the pre-commit hook, and the `/verify` skill all call `bun run verify`. To run one check directly, invoke its script: `bun scripts/check-cycles.ts`. Don't add package.json aliases per-check.

## 5. Project layout

```
ra11y/
├── .claude/                 # Phase 0 autonomous infrastructure
│   ├── settings.json        # Hook wiring
│   ├── backlog.md           # Persistent to-do list — /continue reads this
│   ├── history.jsonl        # Append-only audit log (gitignored)
│   ├── notes/               # Session-durable learnings
│   ├── hooks/               # TypeScript hook scripts run by bun
│   ├── agents/              # Subagent definitions (markdown + frontmatter)
│   └── skills/              # Skills (folders with SKILL.md + supporting files)
├── .github/                 # CI workflows, issue templates, PR template
├── src/
│   ├── index.ts             # Public programmatic API entry (re-exports from src/api/)
│   ├── cli.ts               # Binary entry (thin wrapper over src/cli/)
│   ├── types/               # Single source of truth for shared types
│   ├── engine/              # Scanner machinery (scanner, rule-runner, registries)
│   ├── standards/           # Growable content: WCAG 2.2, 2.1, Section 508, EN 301 549
│   ├── rules/               # Growable content: rules organized by domain
│   ├── input/               # Parsers (tsx, html, css, tailwind) + file discovery
│   ├── output/              # Formatters (terminal, json, sarif, junit, html, markdown) + theme
│   ├── reports/             # Structured reports (coverage, vpat, certification, checklist)
│   ├── config/              # Config loading + validation
│   ├── api/                 # Public API surface (defineRule, defineStandard, defineConfig, defineFormatter)
│   ├── cli/                 # CLI internals (args parser, commands, help)
│   └── utils/               # Zero-dep primitives (ansi, args, glob, contrast, string-width, logger)
├── tests/                   # Mirrors src/ exactly; plus integration, snapshot, cli, fuzz, golden, fixtures
├── docs/                    # User docs + architecture + ADRs + indexed KB (docs/kb/ for agent retrieval)
├── examples/                # Precommit, CI, plugin examples
├── scripts/                 # All .ts, run with bun (guards, generators, bench)
├── CLAUDE.md                # This file
├── README.md                # Shop window
├── CONTRIBUTING.md          # Contributor onboarding
├── CHANGELOG.md             # Keep a Changelog format
├── SECURITY.md              # Vulnerability reporting + plugin trust model
├── ACCESSIBILITY.md         # ra11y's own accessibility statement
├── CODE_OF_CONDUCT.md
├── LICENSE                  # MIT
├── biome.json
├── tsconfig.json
└── package.json
```

## 6. The three-layer model

```
  ┌────────────────────────────────────────────────────────┐
  │  Standards Layer                                        │
  │  WCAG 2.2, 2.1, Section 508, EN 301 549, …              │
  │  Each standard is a versioned module declaring criteria │
  └────────────────────────────────────────────────────────┘
                            ▲
                            │ criteria reference
                            │
  ┌────────────────────────────────────────────────────────┐
  │  Criteria Layer                                         │
  │  wcag22:1.4.3, section508:1194.22.c, en301549:9.1.4.3   │
  │  A criterion belongs to one standard, has a level,      │
  │  is satisfied by one or more rules                      │
  └────────────────────────────────────────────────────────┘
                            ▲
                            │ satisfies: Criterion[]
                            │
  ┌────────────────────────────────────────────────────────┐
  │  Rules Layer                                            │
  │  contrast/minimum, alt-text/missing, focus/visible, …   │
  │  A rule can satisfy multiple criteria across standards  │
  └────────────────────────────────────────────────────────┘
```

Accessibility standards overlap massively. A contrast check satisfies WCAG 1.4.3 AA, Section 508 §1194.22(c), and EN 301 549 9.1.4.3. Separating *what to check* (rules) from *why it matters* (criteria) from *which framework cares* (standards) kills duplication. Running with `--standard wcag21` vs `--standard wcag22` activates the same rule and cites the 2.1 criterion ID in output.

At registry init, the engine walks every loaded standard's `equivalentTo` field and builds a reciprocal index: `rulesBySatisfied: Map<criterionId, Set<ruleId>>`. This lets thin standards (Section 508, EN 301 549) get full coverage for free via equivalence, without reimplementing rules.

## 7. How to add a new rule

**Shortcut:** invoke `/add-rule <criterion-id>` and the skill orchestrates the full workflow. The steps below are what the skill does under the hood and what you do manually when the skill isn't appropriate.

1. Decide the rule ID: `<domain>/<specific-name>`. Domains are the folders under `src/rules/` (contrast, focus, keyboard, aria, semantics, forms, media, motion, pointer, navigation, layout, tooltip, orientation, parsing, document).
2. Identify every criterion the rule satisfies across all loaded standards. Consult `src/standards/*/criteria.ts`. Add cross-standard equivalents via the registry's reciprocal index.
3. Create `src/rules/<domain>/<slug>.ts` with this shape:
   ```ts
   /**
    * Rule: <domain>/<slug>
    * Satisfies: wcag22:X.Y.Z, wcag21:X.Y.Z, section508:…, en301549:…
    * Spec: https://www.w3.org/TR/WCAG22/#<anchor>
    *
    * <Quote the normative text verbatim when helpful.>
    */
   import { defineRule } from "@/api/plugin";

   export const rule = defineRule({
     id: "<domain>/<slug>",
     satisfies: ["wcag22:X.Y.Z", "wcag21:X.Y.Z"],
     severity: "error",
     scope: "node",
     appliesTo: { nodeTypes: ["JSXElement:img"], fileExtensions: [".tsx", ".jsx", ".html"] },
     docs: {
       description: "…",
       rationale: "…",
       goodExample: "…",
       badExample: "…",
       normativeQuote: "…",
       references: ["https://www.w3.org/TR/WCAG22/#…"],
     },
     check(ctx) {
       // Use helpers from src/engine/ast-helpers.ts — do not hand-walk ASTs.
     },
   });
   ```
4. Create `tests/unit/rules/<domain>/<slug>.test.ts` with ≥3 positive, ≥3 negative, ≥1 edge case.
5. Create `tests/fixtures/good/<slug>/` and `tests/fixtures/bad/<slug>/` with minimal reproducers.
6. Register in `src/rules/index.ts`.
7. Run `bun test tests/unit/rules/<domain>/<slug>.test.ts` until green.
8. Run `/fix-drift` to regenerate `docs/kb/rules/<slug>.md` from rule metadata.
9. Run `bun run verify`.
10. Commit in small chunks (see commit discipline below).

## 8. How to add a new standard

**Shortcut:** `/add-standard <id>`.

1. Create `src/standards/<id>/standard.ts`, `criteria.ts`, `metadata.ts`.
2. In `criteria.ts`, enumerate every criterion as a `Criterion` record. For standards that reference WCAG, populate `equivalentTo: ["wcag22:X.Y.Z"]` so existing rules cover the new standard without changes.
3. Register in `src/standards/index.ts`.
4. Create `tests/unit/standards/<id>.test.ts` with golden-file tests: criterion count, level distribution, URL validity, equivalence reciprocal check.
5. Create `tests/integration/<id>-scan.test.ts` that runs the scanner with `--standard <id>` against fixtures and asserts expected violations.
6. Run `/fix-drift` to regenerate `docs/kb/standards/<id>.md`.
7. Run `bun run verify`.

## 9. How to add a new formatter

**Shortcut:** `/add-formatter <name>`.

1. Create `src/output/formatters/<name>.ts` exporting `defineFormatter({ id, format(result, report) })`.
2. Register in `src/output/formatters/index.ts`.
3. Create `tests/snapshot/<name>.test.ts` with snapshots against fixed `ScanResult` + `ReportData`.
4. Add the format ID to the CLI's `--format` validator in `src/cli/args.ts`.
5. Document in `docs/cli.md` if the output needs explanation.

## 10. Autonomous development workflow

This repo is designed for autonomous Claude Code sessions. Prefer the workflow below over ad-hoc editing.

### Orchestrator-Workers (main session as orchestrator)

Subagents cannot spawn subagents, so the orchestrator is always the **main** Claude session. The `/continue` skill is the driver:

1. Read `.claude/backlog.md`.
2. Pick the next unchecked item.
3. Dispatch to the right specialist subagent via the Agent tool.
4. When the subagent returns, verify the work (`bun run verify`).
5. Commit.
6. Check off the backlog item.
7. Loop. Hard cap: 20 items per `/continue` invocation.

### Evaluator-Optimizer (rule development)

The `/add-rule` skill uses a generator+critic loop: `rule-implementer` produces, `a11y-reviewer` critiques against the WCAG normative text, feedback re-enters the generator. Max 3 iterations before reporting BLOCKED.

### Specialist subagents (see `.claude/agents/`)

| Agent | Purpose | Model |
|-------|---------|-------|
| `rule-implementer` | End-to-end rule scaffolding from a criterion ID | opus |
| `standard-builder` | New standard modules | opus |
| `spec-researcher` | WebFetch + summarize a11y specs | sonnet |
| `parser-author` | In-house parsers | opus |
| `formatter-author` | Output formatters | sonnet |
| `fixture-generator` | Good/bad test fixtures | haiku |
| `test-author` | Edge cases, property tests, fuzz | opus |
| `a11y-reviewer` | Critic for rule correctness vs WCAG | opus |
| `code-reviewer` | Independent correctness review | opus |
| `type-smith` | Owns `src/types/` and `src/engine/ast-helpers.ts` | opus |
| `dependency-auditor` | Enforces zero-dep invariant | sonnet |
| `doc-writer` | Long-form docs | sonnet |
| `benchmark-tuner` | Profiles + optimizes hotspots | opus |
| `fixture-curator` | Real-world snippet library | sonnet |
| `migration-author` | Breaking-change migration guides | sonnet |
| `release-captain` | Version bump + changelog + publish | sonnet |

### Skills (see `.claude/skills/`)

`/add-rule`, `/add-standard`, `/add-formatter`, `/verify`, `/review`, `/fix-drift`, `/bench`, `/standards-audit`, `/session-state`, `/research-latest`, `/continue`, `/release`.

### Hooks (see `.claude/hooks/`)

- `session-start.ts` — dashboard (branch, phase progress, rule count, test status)
- `user-prompt-submit.ts` — inject current state header into every prompt
- `pre-tool-use.ts` — block dangerous Bash/Edit patterns
- `pre-commit.ts` — full verify gate on `git commit`
- `post-edit.ts` — format + typecheck + targeted tests after any Edit/Write
- `post-tool-failure.ts` — audit log
- `subagent-stop.ts` — validate subagent output shape; reject rules missing WCAG citation
- `stop.ts` — pre-yield verification sweep
- `notification.ts` — system notification on long idle
- `instructions-loaded.ts` — log which CLAUDE.md/rules fired

Never circumvent hooks. If a hook blocks you, fix the underlying problem.

## 11. Commit discipline (mandatory)

Every commit — whether you author it or a subagent does — follows these rules. They exist because autonomous runs must be debuggable, reviewable, and interruptible.

1. **One logical change per commit.** One new rule, one new standard criterion batch (≤20 criteria), one formatter, one concept doc, one hook script.
2. **≤400 lines net diff per commit.** Auto-generated files (kb regeneration) go in their own `chore(kb): regenerate …` commit.
3. **5–15 minutes of work between commits.** If you've been working longer without a commit, you're batching too much.
4. **Commit before every verification.** Run `/verify` on committed state.
5. **Commit before delegating.** When `/add-rule` hands off from generator to reviewer, the generator commits first so the reviewer reviews real git state.
6. **Never amend a pushed commit.** Never `--no-verify`.
7. **Conventional commits** (enforced by `scripts/check-commit.ts`):
   - `feat(rules): add contrast/minimum for wcag22:1.4.3`
   - `test(rules): add contrast/minimum edge cases`
   - `fix(engine): standard-filter missed equivalentTo criteria`
   - `chore(kb): regenerate rule index`
   - `docs(kb): add wcag 1.4.3 knowledge base entry`
   - `refactor(engine): extract standard-filter from rule-runner`

One rule typically produces 5–7 commits: skeleton, logic, unit tests, fixtures, kb entry, final polish. If your work would produce more than 7 commits, split it into phases and report back.

## 12. Documentation is a deliverable

Docs are enforced, not optional. When you change behavior, update docs in the same PR. Agents trying to retrieve knowledge do not read source — they read `docs/kb/`.

- **Public API exports in `src/api/`** must have TSDoc with `@param`, `@returns`, `@example`. Enforced by `scripts/check-tsdoc.ts`.
- **Mermaid diagrams** ≤7 nodes, single-direction, labeled edges, preceded by prose. Enforced by `scripts/check-mermaid.ts`.
- **`docs/kb/`** is for agent retrieval. Every WCAG SC, every standard, every rule, every concept gets a dense, headed, ≤500-line markdown file with frontmatter. The three `generate-*-kb.ts` scripts regenerate the auto files; `check-kb-drift.ts` fails CI if generated files are stale.
- **ADRs** in `docs/adr/NNNN-title.md` are append-only; a reversed decision gets a new ADR marked `supersedes 00NN`.
- **Every change type has required doc updates** — see `docs/contributing/change-doc-matrix.md`.

## 13. Performance budget

Enforced in CI by `scripts/bench.ts`:

| Scenario | Budget |
|----------|--------|
| Cold start (spawn → first result) | ≤ 200 ms |
| 10 files, 1k LOC | ≤ 100 ms |
| 100 files, 10k LOC | ≤ 500 ms |
| 1000 files, 100k LOC | ≤ 3 s |

A regression fails the build. Benchmark history is committed to `docs/performance.md`.

## 14. Semver policy

- **Patch** (0.1.x): bug fixes, refactors, docs, tightening detection on an existing rule.
- **Minor** (0.x.0): new rules, standards, formatters, CLI flags, plugin API additions, widening or loosening a rule's detection.
- **Major** (x.0.0): removing rules, renaming rule IDs without a deprecation alias, breaking `Rule`/`Standard`/`Config` shapes, CLI flag removal, exit code semantics change.

v0.x is rapid iteration — treat the plugin API as semi-stable until v1.0.

## 15. Rule coverage matrix (v0.1.0 target)

The full matrix lives in `docs/kb/standards/wcag22.md`. The short version: every row marked "auto" or "partial" under WCAG 2.1 A+AA and WCAG 2.2 A+AA additions ships in v0.1.0. That is ~30 automated rules. Every manual-only criterion gets a checklist entry in `src/reports/checklist.ts`.

## 16. Release process

1. All v0.1.0 backlog items checked off.
2. `bun run verify` + `bun run build` green.
3. `scripts/generate-changelog.ts` walks git log from last tag and emits Keep-a-Changelog markdown for review.
4. `/release <version>` bumps `package.json`, commits, tags.
5. `release.yml` publishes to npm on tag push with `npm publish --provenance`.
6. GitHub release with changelog excerpt.

## 17. Common mistakes

- Adding a dependency "just for this one thing." → implement in `src/utils/`.
- Generic fix suggestions. → inspect surrounding AST nodes and produce context-aware text.
- Touching engine code when adding a rule. → rules are content; the engine is stable.
- Patching a test to make it pass. → the WCAG spec is source of truth. Fix whichever is wrong.
- Using `Bun.file()` or similar in `src/`. → Node-compatible APIs only in `src/`. Bun-specific usage stays in tests/scripts/hooks.
- Skipping `/verify`. → precommit hooks catch it, but develop the habit.
- `// @ts-ignore`. → fix the type.
- Committing without a WCAG citation in the rule header. → CI rejects.
- Tuning heuristics for "human reviewer fatigue." → the consumer is an agent (see § 1, Consumer model). Surface honestly with enough context for the agent to triage, instead of suppressing or downgrading.
- Trimming `meta` fields to look terse. → those fields are scan-confidence telemetry the agent uses to plan its next call.

## 18. When in doubt

- WCAG interpretation: quote the spec normatively in the rule file and link to `https://www.w3.org/TR/WCAG22/#<sc-anchor>`.
- Design choice not covered here: prefer smallest code, clearest types, zero deps, spec-accurate, test-first.
- Stuck after 3 fix attempts on a rule: report "BLOCKED: <reason>" and stop.
- Anything auth / push / external / irreversible: confirm with the user before acting.

## 19. Contact points

- WCAG 2.2 spec: https://www.w3.org/TR/WCAG22/
- WCAG 2.1 spec: https://www.w3.org/TR/WCAG21/
- Architecture deep dive: `docs/kb/architecture/three-layer-model.md` and `docs/kb/architecture/rule-engine.md`
- Rule authoring guide: `docs/kb/patterns/writing-a-rule.md`
- Standard authoring guide: `docs/kb/patterns/writing-a-standard.md`
- Gotchas: `docs/kb/gotchas/`

Ship something beautiful.
