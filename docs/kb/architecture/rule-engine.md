---
title: Rule engine
description: How ra11y's scanner loads standards, filters rules by enabled criteria, and runs the per-file lifecycle.
layer: architecture
audience: contributor
---

# Rule engine

The rule engine is the machinery under `src/engine/` that turns a list of files into a list of violations. This doc explains the wiring — the three registries, the standard filter, and the per-file rule-runner lifecycle. It's the companion to [`docs/architecture.md`](../../architecture.md), which covers the broader three-layer model.

## Entry point

The engine's public surface is `runScan()` in `src/engine/scanner.ts`:

```ts
export function runScan(inputs: ScanInputs): ScanProducts;

interface ScanInputs {
  readonly standards: readonly Standard[];
  readonly rules: readonly Rule[];
  readonly enabled: readonly string[];
  readonly files: readonly ParsedFile[];
  readonly isTTY?: boolean;
}

interface ScanProducts {
  readonly result: ScanResult;
  readonly report: ReportData;
}
```

Inputs are already-parsed files — the engine is deliberately decoupled from file discovery and parsing. That lets tests drive the engine end-to-end with synthetic in-memory ASTs (see `scripts/bench.ts` for the benchmark harness, and `tests/helpers/run-rule.ts` for the unit-test helper).

## The three registries

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
│  RulesRegistry       │  by rule ID + rulesBySatisfied reverse index
└──────────────────────┘
```

Each registry is populated fresh on every `runScan` call. A persistent-daemon mode with cached registries is on the roadmap for v0.2.0; v0.0.x pays the rebuild cost every time.

### StandardsRegistry (`src/engine/registry/standards.ts`)

Thin — it's a `Map<standardId, Standard>` with a `register()` method that rejects duplicate IDs. Every loaded standard goes in here. There's no priority or ordering between standards; the criteria registry handles cross-standard relationships.

### CriteriaRegistry (`src/engine/registry/criteria.ts`)

Flattens every criterion from every loaded standard into a single `Map<criterionId, Criterion>` keyed by the globally-unique ID (`<standardId>:<localId>`). Duplicate criterion IDs throw — that's a programming error in the standard module, not a runtime condition.

Also owns the **reciprocal equivalence index**. Each criterion can declare `equivalentTo: ["wcag22:1.4.3"]`, and `rebuild()` walks every criterion to build a symmetric `Map<criterionId, Set<criterionId>>`. If A.equivalentTo includes B, then any rule that satisfies A also satisfies B, and vice versa.

`equivalenceClosure(criterionId)` returns the full breadth-first closure — if A ↔ B and B ↔ C, closure(A) = {A, B, C}. This is what lets `contrast/minimum` cite WCAG 2.2, WCAG 2.1, Section 508, AND EN 301 549 simultaneously despite only declaring `satisfies: ["wcag22:1.4.3"]`.

Missing `equivalentTo` targets are silently skipped — they might refer to an optional standard the user didn't load. `scripts/check-kb-drift.ts` (planned) will catch truly dangling references.

### RulesRegistry (`src/engine/registry/rules.ts`)

Indexes every rule by `id` and builds a **reverse** `rulesBySatisfied: Map<criterionId, Set<ruleId>>` by walking each rule's `satisfies` list through the criteria registry's equivalence closure. This gives O(1) answers to both "which rules cover WCAG 1.4.3?" and "which criteria does `contrast/minimum` cite under the currently-enabled standards?".

Rule IDs must be unique — duplicates throw at `register()` time.

## Standard filter (`src/engine/standard-filter.ts`)

The standard filter is the single glue piece between the registries and the rule runner. Given the set of standards the user asked for (`--standard wcag22,section508`), it answers two questions per rule:

```ts
interface StandardFilter {
  isRuleActive(rule: Rule): boolean;
  citedCriteria(rule: Rule): readonly string[];
}
```

**`isRuleActive`**: walks the rule's `satisfies` list, expands each entry through `criteriaRegistry.equivalenceClosure()`, and checks whether any resulting criterion belongs to an enabled standard. If yes, run the rule. If no, skip it.

**`citedCriteria`**: same walk, but collects the criterion IDs belonging to enabled standards — deduplicated and sorted. A rule scanning under `--standard wcag22,section508` will cite both `wcag22:1.4.3` and `section508:1194.22.c` on every violation it emits, because the standard filter fans out through the equivalence closure at this boundary.

This is the whole multi-standard architecture, in 50 lines. Rules don't know about standards. Standards don't know about rules. The filter bridges them at scan time.

## Per-file rule execution (`src/engine/rule-runner.ts`)

For each parsed file, the scanner calls `runRulesForFile(input)`:

```
┌─────────────────────────────────────────────┐
│  for each rule in inputs.rules:              │
├─────────────────────────────────────────────┤
│  1. filter.isRuleActive(rule)                │  skip if false
├─────────────────────────────────────────────┤
│  2. applies() — file extension check         │  skip if false
├─────────────────────────────────────────────┤
│  3. filter.citedCriteria(rule)               │  collect criterion IDs
├─────────────────────────────────────────────┤
│  4. buildContext(file, sink)                 │  per-call RuleContext
├─────────────────────────────────────────────┤
│  5. try:                                     │
│       rule.beforeFile?.(fileCtx)              │
│       collectReturn(rule.check?.(ctx))       │
│       collectReturn(rule.afterFile?.(fileCtx))│
│     catch err:                                │
│       push internal/rule-crash violation     │
├─────────────────────────────────────────────┤
│  6. for each emitted violation:              │
│     - skip if ctx.isDisabled(line, ruleId)   │
│     - stamp ruleId, criteria, filePath       │
│     - push into out                          │
└─────────────────────────────────────────────┘
```

A few invariants fall out of this shape:

- **A crashing rule never crashes the scanner.** The try/catch around the lifecycle converts any thrown exception into a synthetic `internal/rule-crash` violation with the error message. The scan continues with the next rule.
- **Rules don't know their own file path.** The engine stamps `filePath` onto every emitted violation after the fact. Rules emit with `filePath: ""` as a placeholder. This keeps rules trivially unit-testable — you can invoke a rule with a synthetic AST and no file system.
- **Inline disables are honored after emit.** A violation whose line number is covered by a `ra11y-disable-next-line` or a `ra11y-disable`/`ra11y-enable` region for that rule ID is filtered out before it joins the final list. The rule itself never learns the emission was suppressed — that's the engine's job.
- **Rule metadata is stamped once per file.** `ruleId` and `criteria` are copied onto each emitted violation inside `stampViolation`. The criterion list comes from `filter.citedCriteria(rule)` — it's pre-computed once per file and reused for every emission by that rule in that file.

## Context building (`src/engine/context-builder.ts`)

`buildContext(input, sink)` creates the `RuleContext` that rules see inside `check()`. The context includes:

- `filePath`, `source`, `language`, `ast` — the parsed input
- `enabledStandards` — a `ReadonlySet<string>` the rule can inspect to branch behavior
- `emit(violation)` — pushes into the per-file sink array
- `isDisabled(line, ruleId)` — checks the file's inline-disable map

The context is *per-rule-invocation*, not per-file. Each rule gets its own fresh context so no cross-rule state can leak through the `emit` sink.

## Deterministic violation order

`scanner.ts` sorts all collected violations with `compareViolations()` before returning:

```ts
function compareViolations(a: Violation, b: Violation): number {
  if (a.location.filePath !== b.location.filePath) {
    return a.location.filePath < b.location.filePath ? -1 : 1;
  }
  if (a.location.line !== b.location.line) return a.location.line - b.location.line;
  if (a.location.column !== b.location.column) return a.location.column - b.location.column;
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  return 0;
}
```

Determinism matters for:
- Baseline fingerprints (same input → same output)
- Snapshot tests (no flake)
- Diff-friendly `--format json` output
- CI reporting UIs that assume stable ordering

## Report building

After the violation list is complete, `buildReportData()` produces the `ReportData` used by formatters and reports. For each enabled standard, it counts:

- `total` — criteria in the standard
- `automated` — criteria that are `automatable: "full"` or `"partial"` (we can check them)
- `failing` — automated criteria that have at least one violation
- `passing` — automated criteria with zero violations
- `manualReviewNeeded` — criteria with `automatable: "manual"` (the whole standard's manual-only list, deduplicated across standards)

This is the data behind `--coverage`, `--vpat`, `--certification`, and `--checklist`.

## Extension points

New rules, standards, and formatters all plug in via the public `define*` helpers in `src/api/`:

- `defineRule()` validates the rule shape and returns it typed as `Rule`
- `defineStandard()` validates the standard shape and returns it typed as `Standard`
- `defineFormatter()` validates the formatter shape and returns it typed as `Formatter`
- `defineConfig()` is an identity helper for `.ts` config files

None of these touch engine code. The engine consumes standards and rules through the registries; formatters consume `ScanResult` + `ReportData` through the output layer. Extension is always content, never engine.
