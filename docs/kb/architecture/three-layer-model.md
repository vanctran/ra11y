---
title: "Three-layer model: standards, criteria, rules"
topic: architecture
audience: agents, contributors
---

# Three-layer model: standards, criteria, rules

ra11y separates *what to check* (rules) from *why it matters* (criteria) from *which framework cares* (standards). See [ADR 0002](../../adr/0002-three-layer-standards-criteria-rules.md) for the decision rationale; this page is the runtime walkthrough.

## The shape

```
  ┌──────────────────────────────────────────────────────┐
  │  Standards                                            │
  │  src/standards/wcag22, wcag21, section508, en301549   │
  │  Each is pure data — metadata + a list of criteria.   │
  └──────────────────────────────────────────────────────┘
                            ▲
                            │  declares
                            │
  ┌──────────────────────────────────────────────────────┐
  │  Criteria                                             │
  │  wcag22:1.4.3, section508:1194.22.c, …                │
  │  Each has an id, a level, a URL, and optionally an    │
  │  equivalentTo list mapping to other loaded criteria.  │
  └──────────────────────────────────────────────────────┘
                            ▲
                            │  satisfies: [criterion-id, …]
                            │
  ┌──────────────────────────────────────────────────────┐
  │  Rules                                                │
  │  src/rules/media/alt-text-missing, contrast/minimum…  │
  │  Pure functions over an AST. Never import a standard. │
  └──────────────────────────────────────────────────────┘
```

## The trick: `equivalentTo` propagation

A rule says `satisfies: ["wcag22:1.1.1"]`. It does not enumerate Section 508 or EN 301 549.

Instead, those standards declare the mapping on their own side:

```ts
// src/standards/section508/criteria.ts
{ id: "section508:1194.22.a", equivalentTo: ["wcag22:1.1.1"], … }
```

At registry init, the engine walks every loaded standard's `equivalentTo` and builds a reciprocal index — a `Map<criterionId, Set<ruleId>>`. When a scan enables `wcag22 + section508`, a violation from `media/alt-text-missing` cites both `wcag22:1.1.1` and `section508:1194.22.a` — the rule knows about WCAG, the engine knows about the equivalence, the violation carries both.

Adding a new standard is additive:
- `equivalentTo`-heavy standards (Section 508, EN 301 549, corporate guidelines) ship as pure data with zero new rules.
- Standards with genuinely novel requirements ship rules alongside.

Adding a new rule is additive:
- Declare the WCAG criterion in `satisfies`.
- The engine fans out to every loaded standard that maps it.
- Rule authors never touch standard code.

## Why this matters for the multi-standard promise

From the user's perspective:

```sh
ra11y --standard wcag22,wcag21,section508,en301549 src/
```

runs *the same rule set*. Output, VPAT, and certification reports cite the right IDs per standard without any per-standard rule code. See [`tests/integration/multi-standard-scan.test.ts`](../../../tests/integration/multi-standard-scan.test.ts) for the end-to-end proof.

## Invariants

- **Engine never imports from rules or standards.** It consumes both through registries.
- **Rules never import from standards.** They cite criterion IDs as strings; the engine resolves them.
- **Standards never import from rules.** They're pure data; they don't know which rules satisfy their criteria.
- **Registries are built once per scan.** The `equivalentTo` closure is O(n) in total criteria (tiny) and happens before any file is parsed.

## See also

- [`registries.md`](./registries.md) — the three registry modules (`standards.ts`, `criteria.ts`, `rules.ts`) and how they chain.
- [`rule-engine.md`](./rule-engine.md) — how rules execute against a single file.
- [ADR 0002](../../adr/0002-three-layer-standards-criteria-rules.md) — why we made this choice.
