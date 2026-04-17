# CLAUDE.md — ra11y contributor guide

This file is the source of truth for anyone (human or Claude Code) working on ra11y. It tells you what the project is, what invariants it must uphold, how to verify changes, how to add rules and standards, and where to look next. Read it all before making changes.

## 1. Project identity

**ra11y** is an **AI-first multi-standard accessibility scanner** for web projects. It parses JSX/TSX, HTML, and CSS with in-house zero-dependency parsers and runs a hybrid static-analysis + AST check against pluggable accessibility standards — WCAG 2.2/2.1, Section 508, EN 301 549 out of the box, with a plugin API for adding more.

"AI-first" is the design center, not a bolt-on. The primary consumer is an AI coding agent calling the MCP tools; the CLI, formatters, and reports exist but inherit their shape from that assumption. Several common tooling defaults invert under this framing — see the "Consumer model: AI-first" subsection below and treat the rules there as load-bearing when building new surfaces or triaging field reports.

Name: homophone of "rally" (a call to action for accessibility) with the `a11y` numeronym baked in. Binary: `ra11y`. npm package: `@ra11y/core` (the unscoped `ra11y` name is owned by a long-dormant package; scoped is our way in). License: MIT.

Design priorities — the things the project optimizes for, in roughly decreasing importance:

- **AI-first MCP server.** An agent-native tool surface — `scan_project` with inline `autoDetectWrappers` + `additionalPaths`, `checklist` with ranked review candidates, `suggest_fix` with primary/alternative fix paths, `detect_native_wrappers` for one-shot onboarding. Responses carry scan-confidence telemetry (opaque component counts, template-directive handling, CSS coverage ratios) so the agent knows when the scan had teeth. Canonical inventory: `tools/list` on the server.
- **Zero runtime dependencies.** Nothing in `dependencies`. Everything in-house. Tiny install, tiny supply-chain surface, appealing for a compliance tool.
- **Multi-standard architecture.** Standards → Criteria → Rules. One rule can satisfy WCAG 2.2, WCAG 2.1, Section 508, and EN 301 549 criteria simultaneously. Adding a new standard never touches rule code.
- **VPAT + certification scorecard.** `--vpat`, `--certification`, and `--checklist` produce VPAT-shaped output and a readiness scorecard — the thing teams actually need when pursuing WCAG certification.
- **Precommit-speed.** Sub-second on typical commits. Precommit-friendly. Performance budget enforced in CI.
- **Polish on the human-facing surfaces.** Beautiful terminal output, context-aware fix suggestions, multiple output formats, plugin API, deep rule metadata. Not the design center, but earned after the AI-first surface is honest.

### Consumer model: AI-first

ra11y's primary consumer is an AI agent calling the MCP tools — not a human reading a dashboard. CLI and formatters exist, but the design center is the agent. Several common tooling defaults invert under this assumption; treat the following as load-bearing when triaging field reports or designing new surfaces:

- **Surface, don't suppress.** Agents read every candidate in milliseconds; reviewer fatigue isn't the constraint a human-facing tool optimizes around. False positives a human would tune out are cheap for an agent to dismiss with one file read. Suppression discards signal the agent would use to triage. Default to surfacing with enough context for the agent to investigate.
- **Don't downgrade priority to hide things.** "Mark as low priority" is a UX lever for human attention budgets. Agents don't have one — they just sort. Surface honestly and let the agent rank by criterion + reason + context.
- **Verbose meta is signal, not clutter.** `configSource`, `configSearchedFrom`, `activeNativeWrappers`, `rulesEvaluated`, per-extension file counts — these are scan-confidence telemetry the agent actively uses to decide whether the scan had teeth and what to call next. Don't trim them to look terse.
- **Review *candidates*, not assertions.** For manual criteria, return locations + a short `reason` that frames the question. Don't try to be smart about "what the user really meant" — agents are better at that than heuristics.
- **One tool call should answer "what next?"** Each response carries `nextStep` hints, criterion IDs, and counts that match the other tools' counts. Cross-surface drift (`scan` says 21, `checklist` says 4) forces wasted round trips; invariants like the manual-review-count test exist to prevent this.
- **Default-exclude globs are suppression too.** Growing `DEFAULT_EXCLUDED_PATTERNS` in `src/input/discover.ts` to "reduce noise" from scans is the same mistake as downgrading severities or silencing finders — it just happens one level earlier in the pipeline. An agent can dismiss a finding whose path contains `test/fixtures/` or `stories/` in one read; it can't un-suppress a file that never got parsed. Only add an exclusion when findings in that path tree are *definitionally wrong for any consumer* (generated code, `.min.*`, vendor dumps). "Most people don't want to see this" is a human-attention argument, not a correctness one; it is not sufficient. If an existing entry in the list can't clear that bar, it's a bug, not a precedent.
- **No heuristic suppression, even for spec carve-outs.** WCAG's exemptions (logotypes, process-page exception, essential presentation) are conceptual rules — *detecting* whether a given element falls under one is a heuristic on weaker evidence than the agent has. An `<img>` with `alt="Acme logo"` might be a brand mark, or it might be a product shot the author mislabeled. A repo with three HTML files might be an SPA shell, or it might be the start of a content site. Our attribute-level snippet is not enough to make that call; the agent reading the whole file is. Encoding a heuristic as suppression replaces honest "please verify" with false confidence and risks silent false negatives on real violations. The deterministic escape hatch is the source-level disable pragma (`<!-- ra11y-disable wcag22:1.4.5 -->` / `{/* ra11y-disable wcag22:2.4.5 */}`) — once an agent investigates and dismisses, the pragma makes that dismissal durable. No guessing required. If a specific review candidate keeps drawing field-report complaints, the fix is better `reason` text (so the agent dismisses faster), not a finder-level carve-out.
- **Labeled buckets are suppression too.** "Splitting findings into a primary list and a deprioritized/verbose/likely-X bucket" is the move that looks like labeling but behaves like suppression — once consumers learn the bucket is skippable by default, the silent-miss failure mode is identical to hiding the finding outright. A bucket is only honest when its label is *provable from the code* (e.g. `likelyIrrelevant` for "no `<video>` elements in the scanned files" — a deterministic fact). Filename patterns, identifier patterns, and spec-exemption guesses do **not** earn a bucket. They earn reason-text enrichment, which the agent reads per-candidate and acts on individually. The test before adding a new bucket: would the label be correct 100% of the time from the evidence the scanner has? If it's a heuristic, the answer is no.
- **Failure modes are asymmetric; the rules above lean against the cheaper failure.** Over-surfacing → the agent dismisses in one read, at a few seconds' cost, and the judgment stays visible. Under-surfacing → a real violation never reaches the agent; the user doesn't know it happened; the miss is silent and non-reversible. When a reasonable-sounding field report asks for "less noise" in a way that would hide findings, remember the costs are lopsided — and that "this looks tractable, we can split the difference" is where the silent-miss regressions live. Durable rule: when in doubt, surface and annotate; never bucket-then-filter.
- **Numeric-threshold heuristics are suppression.** "Auto-dismiss when the setTimeout duration is ≤ 5 seconds," "only flag when the image is ≥ 100px wide," "require at least N call sites before reporting" — thresholds dressed up as precision checks are the same heuristic-suppression move as filename-pattern matching. The threshold picks a point on a continuous axis and hides everything on one side of it; the silent-miss failure mode is identical. A real session timeout of 4.5 seconds is indistinguishable from a debounce of 4.5 seconds from static analysis alone, and the agent reading the surrounding code is the only correct arbiter. Encode the duration/size/count in the `reason` text as additive context ("setTimeout with 2000ms literal"); let the agent decide.
- **Don't duplicate capability the agent already has.** Before adding in-tool analysis — cross-file identifier resolution, path walking, fuzzy name matching — ask whether the consuming agent can do the same thing with Read + Grep. If yes, the tool doing it risks being redundant at best and confidently wrong at worst: in-tool heuristics produce output the agent can't tell to mistrust ("`handleChange` defined at line 42, body is clean" is a liability the first time line 42 is a shadowed binding). The tool's job is to *point* — file, line, pattern; the agent's job is to *investigate*. This inverts the default for human-facing tools, where doing more in-process is usually better. Reflex check every time feedback asks for "smarter" analysis in a finder.
- **Interrogate the problem before accepting the solution's shape.** When feedback says "add a show_X tool" or "we need a Y flag," the first check is whether the capability already exists in a tool or call that wasn't discovered. Field reports carry the *problem* the reporter hit, not evidence of a structural gap. Accepting the solution's shape short-circuits that check and creates tool-bloat — more shapes on `tools/list`, more drift surface, more overlap — paid even when the underlying problem was documentation. If the capability exists but is hard to find, sharpen the tool description; if it doesn't, then design.
- **Ambiguous field shapes are dishonest.** A field that is sometimes populated and sometimes `""` (or `null` used as "unknown") forces the agent to re-read and disambiguate whether the value is unavailable or genuinely empty — and because agents usually treat the empty value as real data, the downstream mistake is silent. Omit the field entirely when it has no meaningful value; use conditional spreads at the response-assembly site (`...(x ? { field: x } : {})`). `newText: ""` under `kind: "edit"` is the canonical mistake; `snippet: ""` alongside a populated `sourceContext` is the same bug in another place. The test: if a downstream consumer has to ask "did I get an empty answer or no answer?", the shape has failed. This applies only to optional fields — schema-required fields stay populated; the shape signals "present-when-meaningful."

When a field report suggests "reduce noise," ask first: noise for whom? If the answer is "a human reviewer," the answer is usually no — the agent is the consumer and it wants the signal. If the suggestion is "encode this spec exemption as a heuristic so the agent doesn't have to verify," the answer is also no — heuristic detection and spec carve-outs operate at different confidence levels, and the deterministic source-level disable is the correct mechanism. If the suggestion is "put the obvious-noise candidates in their own bucket so I can skip them," the answer is also no — see the asymmetry rule above. Enrich the `reason` text with the dismissal signal; keep the candidate in the primary list.

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
4. Create `tests/unit/rules/<domain>/<slug>.test.ts` with ≥3 positive, ≥3 negative, ≥1 edge case. Each test should name *what real or spec-derived failure mode it guards against* in its description — not rehearse the code you just wrote. "flags `<button aria-label="X">` when visible text is not a substring" is load-bearing; "the function returns 3 when given 3 inputs" is not.
5. Create `tests/fixtures/good/<slug>/` and `tests/fixtures/bad/<slug>/` with minimal reproducers. If the failure mode came from a real codebase (field report, feedback scan), prefer landing a sanitized snippet in `tests/fixtures/real-world/<case>/` (see backlog Phase 23) — that case survives refactors that reshape the unit test.
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

The full matrix lives in `docs/kb/standards/wcag22.md`. The short version: every row marked "auto" or "partial" under WCAG 2.1 A+AA and WCAG 2.2 A+AA additions ships in v0.1.0. Every manual-only criterion gets a checklist entry in `src/reports/checklist.ts`.

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
- Encoding a WCAG exemption (logotype, process-page, essential presentation) as a heuristic suppression in a finder. → spec exemptions are conceptual; their *detection* from static analysis is a heuristic on weaker evidence than the agent has. Point users and agents at the criterion-level disable pragma instead: `<!-- ra11y-disable wcag22:X.Y.Z -->`. Heuristic suppression risks silent false negatives on real violations.
- Adding a "likely-X" / "low-priority" / "verbose-only" bucket to move noisy candidates out of the primary list. → labeled buckets are suppression in disguise; once consumers skip-by-default, the silent-miss failure mode is identical to hiding the finding outright (see § 1, "Labeled buckets are suppression too"). A bucket is only honest when its label is provable from the code (e.g. `likelyIrrelevant` for "no `<video>` elements in scanned files"). Filename, identifier, or spec-exemption heuristics earn reason-text enrichment, not a bucket.
- Splitting the difference on a field report that asks for less noise. → failure modes are asymmetric (see § 1, "Failure modes are asymmetric"). Over-surfacing costs the agent seconds and is reversible; under-surfacing costs the user an accessibility regression and is silent. When in doubt, surface with better `reason` text; never bucket-then-filter.
- Adding a numeric-threshold gate ("only flag when duration ≤ 5s", "size ≥ 100px", "≥ N call sites"). → numeric thresholds are suppression in disguise (see § 1, "Numeric-threshold heuristics are suppression"). Pick any cutoff and you silent-miss the finding on the other side. Encode the numeric evidence in the `reason` text as additive context and let the agent read surrounding code to judge.
- Emitting sentinel-empty values for optional fields (`newText: ""`, `snippet: ""`, `{ items: [] }` on an error path). → ambiguous field shapes are dishonest (see § 1, "Ambiguous field shapes are dishonest"). Conditional-spread the field at the response-assembly site so it is present only when meaningful, and let `undefined`/omission be the "no value" signal. An agent cannot tell empty-as-data from empty-as-absent, and the asymmetric cost of guessing wrong is silent.
- Hardcoding inventory counts in docs ("12-tool MCP server", "49 rules", "four standards", "six formatters"). → these numbers change every release and the docs silently go stale; readers then lose trust when the count doesn't match reality. Write docs so they stay correct as the inventory grows: name the items that matter (`scan_project`, `checklist`, `suggest_fix`, …) without counting them, or point at the canonical source (`tools/list`, `src/rules/index.ts`, `src/standards/index.ts`). Specific counts are acceptable only in changelog entries, release notes, or generated reports where the date/version anchors the number.
- Writing behavior-rehearsal unit tests for a real-world bug. → "the ranker orders alphabetically on ties", "the cap returns 5 entries when given 10" — these re-assert the code you just wrote and need to change every time you refactor; they catch typos, not regressions in behavior the user cares about. A test earns its keep when it encodes either (a) an invariant that survives refactors ("every pragma declaration has a line number," "no finder emits a suppression by filename pattern") or (b) a real-world failure mode with a sanitized repro. For (b), prefer landing the snippet under `tests/fixtures/real-world/<case>/` (see backlog Phase 23) over a unit test that reproduces the bug inline — fixtures survive internal rewrites that reshape the unit-test surface.

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
