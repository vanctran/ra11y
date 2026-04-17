---
title: "ADR 0006: Real-world fixture harness — shape and assertion primitives"
status: Accepted
date: 2026-04-16
---

# ADR 0006: Real-world fixture harness — shape and assertion primitives

## Status

Accepted. Unblocks Track F (v0.2.0). Implementation begins with a harness prototype against `tests/fixtures/real-world/tsx-generics/`; fixture backfill (9 sanitized cases from Apr 2026 leela-feedback rounds) fans out behind the prototype.

## Context

`CLAUDE.md` describes the `fixture-curator` subagent as "the project's moat — edge cases discovered in production codebases that existing a11y tools miss." The directory it is meant to write to — `tests/fixtures/real-world/` — does not exist yet. Current test shape is dominated by implementation-shaped unit tests ("the top-5 cap returns 5 entries," "the ranker orders alphabetically on ties") that have to change every time the code is refactored. Unit-as-regression breaks on the next refactor; real-world fixtures should not.

Five design questions had to resolve before any fixture could land. They mostly ratify the approach prior work had already converged on, but writing them down makes the ADR load-bearing for future contributors and stops fixture authors from re-litigating shape with every new case.

## Decision

The fixture harness is a **thin, static directory layout** with **typed property-based assertions**. One integration test walks `tests/fixtures/real-world/`, runs the existing `scanner` against each `source/` tree, and evaluates each fixture's `assertions.ts` against the result.

### 1. Assertion shape — property-based primitives, not snapshots

**Hand-written, enumerated assertion primitives.** Each fixture declares what it is guarding via a typed `FixtureAssertions` object. No `toMatchSnapshot` on the full scan output — snapshots lock in every coincidence of the current shape and break whenever any `meta` field drifts. Property assertions survive shape drift because each one names exactly the one thing the fixture is guarding.

`FixtureExpectation` primitives (round-trip-safe, decoupled from output-shape internals):

```ts
type FixtureExpectation =
  | { kind: "zero-parse-errors" }
  | { kind: "parse-errors-at-path"; path: string }
  | { kind: "violation-present"; ruleId: string; reasonIncludes?: string }
  | { kind: "no-violation"; ruleId: string }
  | { kind: "candidate-present"; criterionId: string; reasonIncludes?: string }
  | { kind: "no-candidate"; criterionId: string }
  | { kind: "meta-hint-includes"; substring: string }
  | {
      kind: "meta-field";
      path: readonly string[];
      predicate:
        | "present"
        | "absent"
        | { equals: unknown }
        | { contains: string };
    };
```

Snapshot-style golden assertions are deliberately **not** a primitive. If a fixture truly needs "the full canonical clean output," it should land as a narrow `meta-field` with `predicate: { equals: … }` and explicit comment in the fixture's `README.md` describing why the whole shape is the thing being guarded. Cost: authors must enumerate what they care about. Benefit: each fixture is self-documenting about its purpose.

### 2. Per-fixture config — convention over per-file flags

**Bare source-only directory = run `scan_project` with defaults.** A fixture dir containing a `ra11y.config.ts` at its root overrides defaults. Documented on the harness, not per-fixture. Fixtures that need to exercise a specific flag (`autoDetectWrappers`, `additionalPaths`, `suppressions with reasons`) drop the config file in; all other fixtures inherit the default scan shape.

The `FixtureAssertions` object carries a `toolInput` field for per-invocation knobs (e.g. `verboseMeta: true`, `autoDetectWrappers: false`) so the flag-under-test and the config-under-test are legible in one place.

### 3. Relationship to existing `tests/fixtures/{good,bad}/<rule>/`

**Keep them separate namespaces. Do not merge.**

- `tests/fixtures/good/<rule>/` and `tests/fixtures/bad/<rule>/` are rule-level positive/negative cases driving per-rule unit tests. Single rule, binary expectation (0 violations vs N).
- `tests/fixtures/real-world/<case>/` is cross-cutting — one snippet may simultaneously exercise a parser, a coverage hint, a review candidate, and a meta field. The assertion primitives above give per-fixture granularity across all those surfaces.

Merging would force one assertion style onto both, and either namespace would lose its sharp focus. Cross-rule refactors already stress each namespace; merging would stress them together.

### 4. Sanitization policy — minimum rewrite, preserve structure

Snippets come from real codebases; they must not carry the original project's identifiers, copy, or visual style verbatim.

**Minimum rewrite:**

- Brand / component names are renamed to generic equivalents (e.g., `ComposerSendButton` → `ComposerFooButton`; `Acme` → `Widget`).
- Business copy (marketing strings, user-visible labels tied to the source's product) is replaced with neutral placeholder text. Class names stay intact because they often **are** the reproduction (Tailwind class strings, scoped CSS selectors).
- Import paths that refer to private packages get replaced with plausible generics (`@acme/ui` → `@example/ui`).
- URLs are either removed or hashed to opaque strings.

**Keep the structural pattern intact.** JSX shape, attribute presence/absence, file boundaries, control-flow (render-prop, conditional render, ref forwarding) — all untouched. If a rewrite would destroy the reproduction, the pattern is too specific to generalize; the fixture should capture the minimum structural skeleton instead and name the one pattern that reproduces the bug.

### 5. Golden-output generation — no

**Default hand-written; no automatic `--update-golden` flag.** Generated expectations are tempting for "full canonical output" smoke tests, but they lock in every coincidence of current behavior and mask intentional shape drift as "test broke." A hand-written assertion explicitly names the one thing the fixture is guarding; a generated one lets the next shape change silently turn the fixture from a regression guard into a lock-in on the current implementation.

If a case legitimately needs a broad-shape assertion, land it as an enumerated `meta-field` with `predicate: { equals: … }` and an explanatory `README.md` so a future reader understands why the whole shape is the invariant. One primitive, no separate code path.

## Directory layout

```
tests/fixtures/real-world/
  <case-id>/
    source/            # sanitized snippets — scanner input
      *.ts|*.tsx|*.html|*.css
      ra11y.config.ts? # optional — present when flag-under-test requires it
    assertions.ts      # typed FixtureAssertions (see § 1)
    README.md          # origin commit / feedback round + what this fixture guards
```

`assertions.ts` shape:

```ts
import type { FixtureAssertions } from "@/tests/fixtures/real-world/runner";

export const assertions: FixtureAssertions = {
  description:
    "TS generics (Pick<T,K>, ForwardRefRenderFunction<...>) parse without emitting JSX parse errors",
  origin: { commit: "2968d87", feedbackRound: "leela-round-1" },
  toolInput: { autoDetectWrappers: false, verboseMeta: false },
  expectations: [
    { kind: "zero-parse-errors" },
    { kind: "no-violation", ruleId: "*" },
  ],
};
```

## Harness architecture

- Harness lives in `tests/fixtures/real-world/runner.ts` — walks the tree, reads each `assertions.ts` dynamically, runs the existing `scanner` with each fixture's `toolInput`, evaluates expectations.
- One integration test at `tests/integration/real-world-fixtures.test.ts` iterates fixture directories; each fixture becomes one `it(<case-id>, ...)` scoped by `describe("real-world fixtures")`.
- Failure message names the fixture **and** the failing expectation: `"real-world/tsx-generics: expected zero-parse-errors, got 3 parse errors (uuid-like.ts, forward-ref.tsx, array-promise.ts)"`. Never "snapshot mismatch" or "expected 0 to be 1" — always the fixture + the predicate.
- **No new engine code.** Harness reuses `scanner` + `buildCoverageReport` + `buildChecklist`. Assertion primitives are pure functions over the resulting `ScanResult` / `ReportData`.

## Consequences

**Benefits**

- Fixtures survive engine refactors. Assertion primitives are decoupled from internal output shapes; the harness evaluates them against the public scan result.
- Each fixture is self-documenting. The `description` + `origin` + enumerated expectations tell a future reader exactly what the fixture guards.
- Parallelizable. Once the ADR + prototype land, fixture backfill (9 cases) fans out to three `fixture-curator` agents in parallel under the `/continue` dispatch model.
- New bug caught in the field lands as a new directory. No harness code changes; no engine changes; no new assertion machinery.

**Costs**

- Enumeration cost. Every new expectation shape requires a new `FixtureExpectation` variant + an evaluator. We expect the initial set above to cover the 9 backfill cases; future expectations grow this union on demand.
- Authors must know which primitive to reach for. `README.md` in `tests/fixtures/real-world/` documents the primitives with examples of when to use each.
- No automatic bulk update. Deliberate. The cost-of-updating is the signal that someone is changing what the fixture guards — that should be a conscious decision.

## Alternatives considered

**Full-output snapshot match (`toMatchSnapshot`).** Rejected — brittle. Every `meta` field addition breaks every fixture. Future-us spends more time re-snapshotting than catching real regressions.

**Merge `real-world/` into `{good,bad}/<rule>/` namespaces.** Rejected — loses the cross-cutting nature of real-world cases. A single snippet hitting parser + coverage + review-candidate + meta-field has no natural home under a per-rule directory.

**Generated-golden files with an `--update-golden` flag.** Rejected — the lock-in failure mode is silent. A shape drift that should break the test becomes "well, just rerun with `--update-golden`," at which point the fixture no longer guards anything.

**Ad-hoc test files under `tests/integration/real-world/*.test.ts` per case.** Rejected — couples the fixture data to the test framework and duplicates boilerplate. A declarative fixture directory with one shared runner gives us parallelizable backfill and consistent failure messages.

**A new DSL for declaring expectations.** Rejected. Zero-dep constraint aside, a DSL gets us nothing a tagged-union `FixtureExpectation` type doesn't already deliver, and pays for that nothing with a parser and its bugs.

## Follow-up work (Track F in backlog)

- Harness prototype against `tests/fixtures/real-world/tsx-generics/` before committing to the shape.
- 9 fixture backfills from the Apr 2026 feedback rounds: tsx-generics, spa-shell-vite, tailwind-coverage, logotype-annotation, timing-role-hints, template-directives, opaque-components-top, suppression-reason-slot, autodetect-attribution.
- Extend `.claude/agents/fixture-curator.md` with the `tests/fixtures/real-world/` conventions once the prototype is green.
- Policy update in `CLAUDE.md` §7 and §17: when fixing a real-world bug (not adding a new rule from spec), add a sanitized repro to `tests/fixtures/real-world/<case>/` FIRST. Unit tests are for invariants; behavior-rehearsals migrate to real-world fixtures on touch.

## See also

- `.claude/backlog.md` Track F — enumerated fixture backfill with origin commits.
- `docs/kb/patterns/writing-a-test.md` — the broader guidance on invariants-vs-behavior-rehearsals.
- `docs/kb/patterns/adding-a-fixture.md` — rule-level fixture authoring (separate namespace, different rules).
