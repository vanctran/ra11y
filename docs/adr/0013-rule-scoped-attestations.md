# 0013 — Rule-scoped attestations

- Status: Accepted
- Date: 2026-04-18
- Supersedes: none (amends 0011)
- Superseded by: none

## Context

ADR 0011 introduced the `AttestationRecord` + `EvidenceLedger` + `ConformanceStatement` triple. Attestations are keyed by `criterionId`, and `deriveStatus` treats any one `attested: "pass"` source as lifting the criterion to `pass`. `classifyBlocker` in `src/reports/conformance.ts:226-244` treats a `pass` status with at least one non-candidate source as non-blocking.

This has a silent-miss failure mode for **automatable criteria that no rule fully captures**. WCAG 4.1.2 (Name, Role, Value) is the canonical example — 13 of ra11y's built-in rules satisfy it (`aria/role-invalid`, `aria/required-attrs`, `semantics/button-name`, `forms/labels-required`, …), each covering a slice of the criterion's failure modes. A conformance claim on 4.1.2 presumes coverage of the whole criterion, not any single rule.

Concretely: rules run, no violations are emitted; the ledger carries zero sources for 4.1.2; the conformance statement blocks with `"no-evidence"`. An agent then calls `attest({ criterionId: "wcag22:4.1.2", verdict: "pass", reason: "verified button labels in Menu.tsx" })`. One attested source appears on the ledger, `classifyBlocker` clears the block, the statement emits green. But the attestation's reason only speaks to one slice of the criterion; the other twelve rules' worth of failure modes were never verified. The agent's narrow verification was silently promoted to a full criterion-level claim.

A second seam is load-bearing: `src/engine/resolve-pragma-attestations.ts:108-128`. Pragma tokens can name a rule ID (`{/* ra11y-disable aria/required-attrs reason="verified by design" */}`), and the resolver already knows which rule the author named. But at line 118-125 it emits an `AttestationRecord` keyed only by `criterionId` — the rule identity is thrown away. A file-level pragma that disables one rule contributes an attestation indistinguishable from a criterion-wide `attest` call.

This ADR tightens both seams.

## Decision

**Make attestations carry the rule set they cover. Derive criterion "pass by attestation" only when the union of attested rule IDs covers every rule that satisfies the criterion.**

### Shape changes

```ts
// src/types/evidence.ts

interface AttestationRecord {
  readonly criterionId: string;
  readonly ruleIds?: readonly string[];  // NEW
  readonly by: string;
  readonly reason: string;
  readonly attestedAt: string;
  readonly scope?: "project" | "file" | "line";
  readonly location?: Location;
  readonly verdict?: "pass" | "fail" | "n/a";
}

// mirrored on the attested EvidenceSource
type EvidenceSource =
  | { readonly kind: "attested";
      readonly ruleIds?: readonly string[];   // NEW
      readonly by: string; readonly reason: string; readonly attestedAt: string;
      readonly scope?: "project" | "file" | "line";
      readonly location?: Location;
      readonly verdict?: "pass" | "fail" | "n/a"; }
  | …;

type EvidenceStatus = "pass" | "fail" | "partial" | "unknown" | "n/a";  // + "partial"
```

Omitting `ruleIds` on an attestation means "I claim coverage for every rule that satisfies this criterion." The `attest` MCP tool response lists that fan-out explicitly so the agent sees what it just asserted.

### Status derivation

Let `S = RulesRegistry.rulesFor(criterionId)` (set of rule IDs that satisfy the criterion after equivalence closure). Let `A = ⋃ attestation.ruleIds` where omitted `ruleIds` fan out to `S`.

Applied per criterion in strict precedence:

| Condition | `status` |
|---|---|
| Any `static` source OR any attested `"fail"` | `fail` |
| Any attested `"n/a"` (no fail-evidence above) | `n/a` |
| `S` is empty (purely manual criterion), any attested `"pass"` | `pass` |
| `S` is non-empty, `A ⊇ S`, at least one attested `"pass"` | `pass` |
| `S` is non-empty, `A ⊂ S`, at least one attested `"pass"` | `partial` |
| `S` is non-empty, no attestations, no static | `pass` (unchanged Phase-1 default) |
| `S` is empty, no attestations | `unknown` |

Notes:

- **Purely manual criteria** (`S` empty) keep today's semantics. The coverage check is vacuous and a criterion-wide attestation passes.
- **Rule-ran-clean is not positive evidence.** A criterion whose rules all ran without emitting violations still has zero ledger sources. Today's `classifyBlocker` correctly blocks that with `"no-evidence"` for honesty. This ADR does not change that — introducing "rule ran cleanly" as a new evidence source is a separate decision.
- **Conflict resolution.** Any attestation with `verdict: "fail"` wins over any `verdict: "pass"`, regardless of `ruleIds`. A fail attestation is load-bearing — the tool cannot silently override it with a pass claim. Static failures similarly dominate.
- **Scope is ignored by the coverage check.** A line-scoped attestation of rule X "counts" as covering rule X for the criterion-level claim. Scope metadata remains honest documentation on the source; coverage is rule-set membership, not geographic. A future ADR can add scope-aware coverage if field reports show the loose rule causes misses.

### New blocker reason

`src/reports/conformance.ts` adds a fourth value:

```ts
type ConformanceBlockerReason =
  | "no-evidence"
  | "failing"
  | "candidate-only"
  | "partially-attested";  // NEW
```

`classifyBlocker` returns `"partially-attested"` when `status === "partial"`. The agent routes to `attest` with the missing `ruleIds` (enumerable from the ledger entry and `rulesFor`), or to `conformance_statement` which can surface "rules under this criterion still needing attestation" as structured output.

### Pragma resolver

`src/engine/resolve-pragma-attestations.ts` stops collapsing rule-ID pragmas. When a declaration token resolves via the rule path (`token` without `:`), the emitted record carries `ruleIds: [ruleId]`. Criterion-ID tokens (`token` contains `:`) emit attestations without `ruleIds` (criterion-wide), matching their declared scope.

This is the single highest-leverage change in the ADR: the one place in the code that already had rule identity and was dropping it now preserves it.

## Consequences

Types & engine:
- `src/types/evidence.ts` — add optional `ruleIds` to `AttestationRecord` and to the `attested` `EvidenceSource` variant. Add `"partial"` to `EvidenceStatus`. ~20 LOC net.
- `src/engine/evidence-ledger.ts` — update `deriveStatus` to accept `rulesForCriterion: readonly string[]` and apply the coverage check. Update `indexAttestedSources` to propagate `ruleIds`. Update the `deriveStatus` call site at line 80 to pass `rulesFor`. ~40 LOC net.
- `src/engine/resolve-pragma-attestations.ts` — return a struct that distinguishes rule-token from criterion-token, propagate `ruleIds: [ruleId]` for the former. ~15 LOC net.

Reports:
- `src/reports/conformance.ts` — add `"partially-attested"` to `ConformanceBlockerReason`; update `classifyBlocker` to return it for `status === "partial"`; the markdown renderer handles a new column implicitly via the existing `status` + `reason` columns. ~15 LOC net.
- `src/reports/conformance-statement.ts` — expose "missing ruleIds" on the `ConformanceBlocker` struct so the agent doesn't have to cross-reference `rulesFor` separately. ~20 LOC net.
- `src/reports/vpat.ts`, `certification.ts`, `checklist.ts` — pattern-match `"partial"` alongside `"unknown"` in their aggregators. Don't count `partial` as `pass`. ~10 LOC each.

MCP surface:
- `src/mcp/tools/attest*.ts` — accept optional `ruleIds` argument; response lists the satisfying-rules fan-out when `ruleIds` is omitted. ~30 LOC.
- `src/mcp/tools/conformance_statement*.ts` — surface `"partial"` status and `"partially-attested"` blocker reason; include per-rule coverage for blockers where useful. ~20 LOC.

Tests:
- `tests/unit/engine/evidence-ledger.test.ts` — four new derivation cases: purely-manual-with-attestation, automatable-full-coverage, automatable-partial-coverage, rule-fail-overrides-criterion-pass.
- `tests/unit/engine/resolve-pragma-attestations.test.ts` — rule-token pragma emits `ruleIds: [ruleId]`; criterion-token pragma does not.
- `tests/unit/reports/conformance.test.ts` — `"partially-attested"` blocker emitted for partial status.
- Integration test for the worked example (wcag22:4.1.2 + 13 satisfying rules) end-to-end.

No formatter shape changes. No rule-author surface changes. No standard-author surface changes. The `ruleIds` field is optional on existing `AttestationRecord` consumers — durable `.ra11y/attestations.jsonl` entries written before this ADR keep working (missing `ruleIds` = criterion-wide, same as omitting).

Estimated net diff across the split: ~200 LOC source + ~250 LOC tests, under CLAUDE.md § 9's 400-LOC commit cap when split into four commits (ADR / types+ledger / pragma-resolver / MCP+reports).

## Alternatives considered

1. **Reshape the ledger's primary key from `criterionId` to `(ruleId, scope)`.** Cleaner long-term model — criteria become derived views over rule evidence, attestations target rules directly. Rejected for now: the change crosses the 400-LOC commit cap once tests are honest, touches 10+ consumers (every report, every MCP tool), and most of its benefit is forward-looking (runtime-adapter plumbing). Revisit when a field reports surfaces a case the additive fix can't carry.

2. **Add scope-aware coverage** (line-scoped attestation of rule X only covers rule X on that file, not the whole project). Rejected for v0.2: correct, but requires a project-vs-file-vs-line truth table across the criterion×rule×file grid. Current tradeoff is that the coverage check is a set-membership query on rule IDs; scope stays as honest provenance metadata on the source. Revisit if field reports show the loose rule causes misses.

3. **Introduce "rule ran cleanly" as a new static-pass source kind.** Would let automatable criteria report `pass` with positive evidence rather than absence-of-fail, and the coverage check could demand rule-pass coverage without needing attestations. Rejected as too broad for this ADR — it's a separate shape change that touches every rule runner and inflates the ledger by O(rules × files). Keep it as a candidate for a later ADR when field reports show the "no-evidence" block is the bottleneck.

4. **Treat criterion-wide attestations as "always partial" for automatable criteria with multiple satisfying rules.** Rejected: too punitive. A criterion-wide attestation from a reviewer who has actually verified the whole criterion is a legitimate claim. Making that claim requires the author to type out every rule ID would turn honest attestations into bureaucratic ceremony. The response's fan-out disclosure is the honest mechanism: "you just claimed coverage for [list of 13 rules]."
