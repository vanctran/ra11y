---
title: "Registries: the standards / criteria / rules index chain"
topic: architecture
audience: agents, contributors
---

# Registries

Three registry modules sit between the three data layers and the scanner. Each owns one kind of index; the scanner consumes them through a stable interface.

## The three registries

- `src/engine/registry/standards.ts` — indexes loaded `Standard` objects by id. Provides `get(id)`, `all()`, `isLoaded(id)`.
- `src/engine/registry/criteria.ts` — indexes every criterion from every loaded standard, and builds the **reciprocal equivalence closure**: a criterion maps to the full set of criterion ids that claim `equivalentTo` it, walking the graph until it converges.
- `src/engine/registry/rules.ts` — indexes rules by id and builds `rulesBySatisfied: Map<criterionId, Set<ruleId>>`. A rule that satisfies `wcag22:1.1.1` gets registered against `wcag21:1.1.1`, `section508:1194.22.a`, and `en301549:9.1.1.1` too — the equivalence closure does the fan-out.

## Why the chain matters

The scanner asks three questions per scan:

1. "Which standards are enabled?" → `StandardsRegistry.all()`, filtered by the user's `--standard` flag.
2. "For a violation on `wcag22:1.1.1`, which criterion ids should I cite?" → `CriteriaRegistry.cited(criterionId, enabledStandards)` — returns every criterion in the equivalence class that's also in an enabled standard.
3. "For an enabled standard, which rules can produce violations?" → `RulesRegistry.bySatisfied(criterionId)` — returns rule ids.

None of these questions leak back into the rule or standard code. A rule author sees only `criterionId: string`. A standard author sees only `Criterion` records. The indirection is the whole point.

## Initialization

Registries are built once per scan, not once per rule run. The cost:

- `StandardsRegistry`: O(1) per loaded standard.
- `CriteriaRegistry`: O(n × m) where n is total criteria (~90 for WCAG + thin standards) and m is average equivalentTo edges (~2). Trivially fast.
- `RulesRegistry`: O(r × s) where r is total rules (~40) and s is average `satisfies` length (~2). Also trivial.

Total init time: < 1ms on a warm V8/bun process.

## Failure modes the registries catch

- **Typo in a rule's `satisfies`.** Registry build throws with the offending rule id and the unknown criterion id.
- **Asymmetric `equivalentTo`.** If standard A says `a:1` ≡ `b:1` but standard B says nothing about either side, `scripts/standards-audit.ts` reports the asymmetry. Registry build does not fail on it (one-way equivalence is sometimes legitimate) but the audit flags it for review.
- **Unknown `--standard` flag.** `StandardsRegistry.get(id)` returns null; the CLI errors cleanly.
- **Rule satisfying a criterion in an unloaded standard.** No error at build time — the rule is still registered. At scan time, its citations are filtered to enabled standards only, so the unloaded-standard criterion silently drops out.

## See also

- [`three-layer-model.md`](./three-layer-model.md) — the concept the registries implement.
- [ADR 0002](../../adr/0002-three-layer-standards-criteria-rules.md) — why this indirection is load-bearing.
- `src/engine/scanner.ts` — the single entry point that chains the registries together.
