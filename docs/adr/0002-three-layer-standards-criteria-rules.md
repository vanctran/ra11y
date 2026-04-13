---
title: "ADR 0002: Three-layer architecture — standards, criteria, rules"
status: Accepted
date: 2026-04-11
---

# ADR 0002: Three-layer architecture — standards, criteria, rules

## Status

Accepted.

## Context

Accessibility standards overlap massively. A contrast check satisfies WCAG 1.4.3 AA, Section 508 §1194.22(c), and EN 301 549 9.1.4.3 — the same check, three framework citations. ADA claims derive from WCAG. AODA (Ontario) cites WCAG. Corporate guidelines cite WCAG. If each standard ships its own rules, every correctness improvement has to be made in N places and drifts the moment one repo lags.

We also anticipated plugin-authored standards: corporate guidelines, jurisdiction-specific regulations (JIS X 8341, EN 301 549 national derivatives), industry-specific overlays (HIPAA-adjacent, FedRAMP). Each of those ships a handful of criteria — mostly aliases for WCAG — and one or two genuinely new requirements.

Co-locating rules with standards was the default choice for axe-core-style tools. It makes adding a new standard feel easy (drop in files) and makes the relationship between "what's checked" and "what the spec says" more obvious. We rejected it.

## Decision

Three layers, strictly separated:

1. **Standards layer** (`src/standards/`): pure data. One module per standard. Each declares its criteria.
2. **Criteria layer** (derived from standards, indexed in `src/engine/registry/criteria.ts`): every criterion has a stable ID, level, URL, and — critically — an `equivalentTo` list mapping to semantically equivalent criteria in other loaded standards.
3. **Rules layer** (`src/rules/`): pure functions. Each rule declares which criterion IDs it satisfies. A rule can satisfy multiple criteria across multiple standards.

At registry init, the engine walks every loaded standard's `equivalentTo` and builds a reciprocal index: `rulesBySatisfied: Map<criterionId, Set<ruleId>>`. A violation from `media/alt-text-missing` (declared `satisfies: ["wcag22:1.1.1"]`) automatically cites `wcag21:1.1.1`, `section508:1194.22.a`, and `en301549:9.1.1.1` at scan time — because each of those standards' criteria declared `equivalentTo: ["wcag22:1.1.1"]`.

**Adding a new standard never touches rule code.** In practice, a new standard with heavy WCAG overlap (Section 508, EN 301 549) is a pure-data plugin.

**A new rule never touches standard code.** The rule declares its WCAG coverage; the engine fans out to every other standard automatically.

## Consequences

**Benefits**
- v0.1.0 ships Section 508 and EN 301 549 without writing a single new rule. Both are thin `equivalentTo` derivations of WCAG.
- Corporate / jurisdiction plugins are pure data: [`examples/plugin-standard/`](../../examples/plugin-standard/) is five criteria across five lines of `equivalentTo` and does not touch a single rule.
- Adding WCAG 2.3 (when the W3C ships it) is additive: ship a `wcag23` module, mark its criteria as `equivalentTo` their 2.2 analogs, rules catch up for free.
- Coverage + VPAT reports group by standard without any rule-side cooperation.

**Costs**
- The three-way split is harder to onboard onto than the axe-style flat layout. Readers have to understand that a rule's `satisfies` list is the source of truth and the standard-side `equivalentTo` list is its mirror.
- `equivalentTo` is a hand-curated claim. If we say `section508:1194.22.g` is equivalent to `wcag22:1.3.1` and it isn't, we propagate the mistake silently. `scripts/standards-audit.ts` runs a reciprocal-consistency check to catch asymmetric claims.
- The engine has to run a graph closure at init to build the reciprocal index. It's O(n) in total criteria, trivially fast, but it's not free — one more thing the engine has to do before the first file is scanned.

## Alternatives considered

**Flat model — rules know about every standard.** Rejected. `media/alt-text-missing.ts` satisfying a ten-element list grows quadratically, and every rule has to be updated when a new standard appears.

**Deep model — each standard owns its own copy of the rules.** Rejected. Correctness drift and massive duplication.

**Cross-standard rule composition via mixins or inheritance.** Rejected. Too clever; turns rule debugging into a "where does this behavior come from" exercise. `equivalentTo` is a flat, inspectable relationship.

## See also

- [`docs/kb/architecture/three-layer-model.md`](../kb/architecture/three-layer-model.md) — the runtime walkthrough.
- [`docs/kb/architecture/registries.md`](../kb/architecture/registries.md) — how the reciprocal index is built.
- [`tests/integration/multi-standard-scan.test.ts`](../../tests/integration/multi-standard-scan.test.ts) — the end-to-end proof that one rule + four standards = four citations.
