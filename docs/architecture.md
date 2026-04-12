# Architecture

ra11y is built around one core idea: **what to check**, **why it matters**, and **which framework cares** are three separate things. Treating them as separate layers kills duplication, makes cross-standard coverage free, and keeps the engine small enough to audit.

This document is the deep dive. For quick orientation, start with [`getting-started.md`](./getting-started.md).

## The three-layer model

```
┌─────────────────────────────────────────────────────────────┐
│  Standards Layer — pure data                                 │
│  WCAG 2.2, WCAG 2.1, Section 508, EN 301 549, plugin stds    │
│  Each is a versioned module declaring criteria               │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ referenced by
                            │
┌─────────────────────────────────────────────────────────────┐
│  Criteria Layer — flat index                                 │
│  wcag22:1.4.3, section508:1194.22.c, en301549:9.1.4.3        │
│  Each criterion belongs to one standard, has a level, and    │
│  may declare equivalentTo other criteria                     │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ satisfies
                            │
┌─────────────────────────────────────────────────────────────┐
│  Rules Layer — pure functions                                │
│  contrast/minimum, media/alt-text-missing, focus/visible, …  │
│  A rule can satisfy criteria across multiple standards       │
└─────────────────────────────────────────────────────────────┘
```

**Standards** are plain data — a list of `Criterion` records with metadata. No behavior, no logic. Swap one in or out at config time and the scanner reconfigures itself.

**Criteria** are what accessibility frameworks actually care about. `wcag22:1.4.3` is "Contrast (Minimum)"; `section508:1194.22.c` is the Section 508 equivalent. A criterion is identified by `<standardId>:<localId>` so IDs stay globally unique across the registry.

**Rules** are pure functions of the form `(ctx: RuleContext) => Violation[]`. One rule can satisfy many criteria across many standards. The `contrast/minimum` rule cites WCAG 2.2, WCAG 2.1, Section 508, and EN 301 549 in a single scan — it's one check, four citations.

## Why three layers?

Accessibility standards overlap massively. Section 508 §1194.22(c) is WCAG 2.0 1.4.3 with different paperwork. EN 301 549 9.1.4.3 is WCAG 2.1 1.4.3 with European legal framing. If rules were tied to standards, writing a Section 508 scanner would mean reimplementing every WCAG rule with renamed IDs.

The three-layer model means:

- **Adding a new standard never touches rule code.** You write a `Standard` module that declares criteria and their `equivalentTo` WCAG anchors; the existing rule pool snaps into coverage.
- **Running with `--standard wcag21` vs `wcag22` uses the same rules** but cites different criterion IDs in the output. Users see their framework's language without you maintaining parallel rule sets.
- **Rules stay focused on the check itself** — "does this text meet 4.5:1?" — not on which bureaucracy asks for it.

## The equivalence closure

When you register a standard, each criterion may declare `equivalentTo`: other criterion IDs it considers equivalent. The engine walks this graph at registry rebuild time and stores a **reciprocal** index — if `section508:1194.22.c` is equivalent to `wcag22:1.4.3`, then a rule that satisfies either one is considered to satisfy both.

```ts
// src/standards/section508/criteria.ts (excerpt)
{
  id: "section508:1194.22.c",
  standardId: "section508",
  localId: "1194.22.c",
  title: "Color is not the sole means of conveying information",
  level: "base",
  automatable: "partial",
  equivalentTo: ["wcag22:1.4.1", "wcag21:1.4.1"],
}
```

That one `equivalentTo` line is how Section 508 gets a WCAG rule for free.

The closure is computed breadth-first over the reciprocal graph, so chains work: if A ↔ B and B ↔ C, then querying A returns `{A, B, C}`. See `src/engine/registry/criteria.ts` for the implementation.

## Registry rebuild flow

The engine uses three registries. All three are populated fresh on every scan (v0.x — a persistent daemon mode is on the roadmap for v0.2.0):

```
┌──────────────────────┐
│  StandardsRegistry   │  by standard ID
└──────────┬───────────┘
           │ feeds
           ▼
┌──────────────────────┐
│  CriteriaRegistry    │  flat index + reciprocal equivalents
└──────────┬───────────┘
           │ feeds
           ▼
┌──────────────────────┐
│  RulesRegistry       │  by rule ID, plus rulesBySatisfied reverse index
└──────────────────────┘
```

1. **StandardsRegistry** — every `Standard` passed into `runScan()` is registered by `id`. Duplicate IDs throw.
2. **CriteriaRegistry.rebuild()** — walks every registered standard, flattens every criterion into a single `Map<criterionId, Criterion>`, and builds the reciprocal equivalence index. A duplicate criterion ID is a fatal error — criterion IDs must be globally unique across all loaded standards.
3. **RulesRegistry.rebuild(criteria)** — every rule is indexed by `id`, then a reverse `rulesBySatisfied: Map<criterionId, Set<ruleId>>` is built by walking each rule's `satisfies` list through the criteria registry's equivalence closure.

The result: O(1) lookups in both directions. "Which rules cover WCAG 1.4.3?" and "which criteria does `contrast/minimum` cite under the currently-enabled standards?" are both constant-time.

## Standard filter — the multi-standard dispatch

Between the registries and the rule runner sits the **standard filter** (`src/engine/standard-filter.ts`). Given the set of standards the user enabled on the CLI (`--standard wcag22,section508`) and a rule, it answers two questions:

1. **Is this rule active?** Walk the rule's `satisfies` list, expand each entry through the equivalence closure, and check whether any of the resulting criteria belong to an enabled standard. If yes, run the rule. If no, skip it.
2. **Which criteria should this rule cite?** Same walk, but collect the criterion IDs belonging to enabled standards — and deduplicate them. A rule that satisfies WCAG 2.2 1.4.3 scanning under `--standard wcag22,section508` will cite both `wcag22:1.4.3` and `section508:1194.22.c` on every violation it emits.

This is the single mechanism that makes the whole multi-standard architecture work. Rules don't know about standards. Standards don't know about rules. The filter bridges them at scan time with pure data.

## Rule execution lifecycle

For each parsed file, the rule runner does this for each applicable rule:

```
┌─────────────────────────────────────────────┐
│  1. filter.isRuleActive(rule)                │  skip if false
├─────────────────────────────────────────────┤
│  2. applies() — file extension check         │  skip if false
├─────────────────────────────────────────────┤
│  3. filter.citedCriteria(rule)               │  collect criterion IDs
├─────────────────────────────────────────────┤
│  4. buildContext(file, sink)                 │  per-call RuleContext
├─────────────────────────────────────────────┤
│  5. rule.beforeFile?.(ctx)                   │  optional setup
├─────────────────────────────────────────────┤
│  6. rule.check?.(ctx)                        │  the check itself
├─────────────────────────────────────────────┤
│  7. rule.afterFile?.(ctx)                    │  optional teardown
├─────────────────────────────────────────────┤
│  8. For each emitted violation:              │
│     - honor inline-disable pragmas           │
│     - stamp ruleId, criteria, filePath       │
│     - append to the scan's violation list    │
└─────────────────────────────────────────────┘
```

A few details worth knowing:

- **Rules are pure functions over typed AST.** They receive a `RuleContext` with typed AST nodes and AST helpers; they return `Violation[]` (or emit via a sink on the context). No I/O, no mutation, no cross-rule communication.
- **Rules don't know their own file path.** The engine stamps `filePath` onto every emitted violation after the fact. This keeps rules decoupled from file-system state and makes them trivially unit-testable.
- **A crashing rule never crashes the scanner.** The try/catch in `runOneRule` swallows any exception, produces a synthetic `internal/rule-crash` violation with the error message, and the scan continues with the next rule.
- **Inline disables are honored after the rule emits.** A violation whose line number is covered by a `ra11y-disable-next-line` or a `ra11y-disable/enable` region for that rule ID is filtered out before it joins the final list. The rule itself never learns the emission was suppressed — that's the engine's job.

See `src/engine/rule-runner.ts` and `src/engine/context-builder.ts` for the full wiring.

## Input layer

Rules operate on a typed AST. The input layer turns source files into those ASTs with zero runtime dependencies:

- **TSX/JSX parser** — `src/input/parsers/tsx.ts`. Character-driven tokenizer and small recursive-descent parser scoped to just the constructs rules care about (JSX elements, attributes, string literals, identifiers). PascalCase tags are treated as React components (not auto-self-closed as void elements); lowercase known-void tags (`img`, `br`, `input`, …) are.
- **HTML parser** — `src/input/parsers/html.ts`. Similar approach, tuned for HTML5 quirks. Every loop has an explicit progress guarantee so malformed input cannot hang the parser.
- **CSS parser** — `src/input/parsers/css.ts`. Rules, at-rules (including nested `@media`, `@supports`, `@keyframes`), declarations, `!important`, comments, function calls with nested parens. Partial AST on syntax errors so a single broken rule doesn't drop the whole stylesheet.
- **Tailwind class extractor** — extracts utility classes from `className` attributes and resolves the subset rules care about (color, font-size, weight) without depending on Tailwind's runtime.

The parsers live in `src/input/parsers/`. The discovery layer (`src/input/discovery/`) walks the filesystem, respects `.gitignore` and `--exclude`, and hands every parsed file to the scanner.

## Output layer

Violations plus report data flow into the output layer (`src/output/`). Formatters are pluggable — six built-in (`terminal`, `plain`, `json`, `sarif`, `junit`, `markdown`) and a `defineFormatter()` API for custom ones. A formatter is a pure function of `(ScanResult, ReportData) => string`; it never imports from rules or standards.

The terminal formatter owns ra11y's DX: colored output, snippet rendering, fix suggestions, and the coverage scorecard. The SARIF formatter targets GitHub code scanning. JUnit targets CI test-result UIs. JSON and plain are machine-readable.

Reports (`src/reports/`) sit alongside formatters and produce structured views — `coverage`, `vpat`, `certification`, `checklist` — for teams pursuing compliance documentation.

## Plugin boundaries

Everything pluggable lives behind a `defineX` helper in `src/api/`:

- **`defineRule()`** — author a rule. Validated shape; every rule must declare `satisfies` (criterion IDs) and at least one of `beforeFile`/`check`/`afterFile`.
- **`defineStandard()`** — author a standard. Validated shape; criterion IDs must be prefixed with the standard's `id`.
- **`defineFormatter()`** — author an output formatter.
- **`defineConfig()`** — typed config-file helper (identity function in `.ts` configs).

Plugins are just imports. There is no plugin *loader* in v0.1.0 — you import the plugin object directly in `ra11y.config.ts` and reference it by value. A declarative `plugins: { rules: […], standards: […] }` field lands in v0.2.0 to support installing plugins from npm.

See `examples/plugin-rule/` and `examples/plugin-standard/` for end-to-end templates.

## Invariants the architecture enforces

Several architectural rules fall out of the layering and are enforced by guards in `scripts/`:

1. **Rules are pure.** No I/O, no `fetch`, no `node:fs`, no global state. Checked at review time and by network-isolation guard.
2. **Engine never imports from `rules/` or `standards/`.** It consumes them through registries. Keeps the engine's surface stable and rule code swappable.
3. **Formatters never import from `rules/` or `standards/`.** They consume `ScanResult` and `ReportData`. Keeps output backward-compatible when rule internals change.
4. **Zero runtime dependencies.** `dependencies: {}` — enforced by `scripts/check-zero-deps.ts`. Every primitive (color contrast math, ANSI coloring, argv parsing, glob matching, string-width) is in-house under `src/utils/`.
5. **Network isolation.** `src/` never references `fetch`, `node:http`, `node:https`, `node:net`, or `node:dns`. ra11y is a compliance tool that runs against proprietary code — users must trust it is offline.
6. **Every rule cites WCAG.** The rule file header quotes the normative text and links to the spec URL. Every `satisfies` entry must resolve to a real loaded criterion or CI fails.

## Where to look next

- **Adding a rule** — [`CLAUDE.md`](../CLAUDE.md) §7, or run `/add-rule <criterion-id>` in Claude Code.
- **Adding a standard** — [`CLAUDE.md`](../CLAUDE.md) §8.
- **Authoring a plugin** — [`examples/plugin-rule/`](../examples/plugin-rule/) and [`examples/plugin-standard/`](../examples/plugin-standard/).
- **Engine internals** — `src/engine/` is ~500 lines total. Start at `scanner.ts`, follow the imports.
- **The types** — `src/types/` is the single source of truth for `Standard`, `Criterion`, `Rule`, `Violation`, `ScanResult`, `ReportData`, and all AST node shapes.
