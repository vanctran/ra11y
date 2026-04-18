# 0011 — Evidence as a first-class primitive

- Status: Accepted (amended 2026-04-18: dropped `runtime` source kind)
- Date: 2026-04-18
- Supersedes: none
- Superseded by: none

## Context

ra11y's stated priority (CLAUDE.md § 1) includes VPAT + certification —
"the thing teams actually need when pursuing WCAG certification." Static
scanning alone can never deliver a conformance claim. A claim requires
reconciling multiple sources of evidence per criterion:

1. **Static findings** — `Violation[]` from the rule runner.
2. **Review candidates** — `ReviewCandidate[]` from manual-review
   finders; unresolved pointers, not assertions.
3. **Attestations** — an author, CI bot, *or runtime-scanner-via-CI*
   asserting "this criterion is satisfied (or not) for this reason."
   Today encoded as `<!-- ra11y-disable … -->` / `{/* ra11y-disable … */}`
   pragmas, filtered out at scan time rather than recorded as evidence.
   Runtime-tool results (axe-core, Lighthouse, WAVE, Pa11y) also ride
   on this kind — an agent runs the tool in its CI harness, reads the
   vendor JSON, and calls `attest` with a reason citing the run. ra11y
   does not ingest any vendor JSON schema directly.
4. **Sampling verdicts** — LLM-backed MCP sampling tools (ADR 0005
   follow-ups: `tool-verdict-candidate`, `tool-resolve-component`) emit
   per-candidate verdicts. No storage shape today.

Today's scanner emits `ScanResult` with `violations[]` and
`ReportData` with `candidates[]` and `manualReviewNeeded[]`. There is
no unified shape that (a) groups every source by criterion, (b) derives
a per-criterion status, or (c) provides the substrate a conformance
statement can refuse-or-emit from.

Several open backlog items (Track C, 22 open) each propose their own
ad-hoc shape for attestations / runtime results / per-criterion
aggregation. Without a shared primitive, each item introduces another
parallel vocabulary and another drift surface.

## Decision

**Introduce an `Evidence` primitive and an `EvidenceLedger`
derivation, additive to `ScanResult`.** Violations and review
candidates remain the scanner's output; the ledger is derived from
them (and, in later phases, from attestations + runtime ingests +
sampling verdicts) into a per-criterion aggregate.

### Shapes

```ts
// src/types/evidence.ts

type EvidenceStatus = "pass" | "fail" | "unknown" | "n/a";

type EvidenceSource =
  | { readonly kind: "static";    readonly findingId: string }
  | { readonly kind: "candidate"; readonly location: Location; readonly reason: string; readonly confidence: ReviewConfidence; readonly finderId?: string }
  | { readonly kind: "attested";  readonly by: string; readonly reason: string; readonly attestedAt: string; readonly scope?: "project" | "file" | "line"; readonly location?: Location; readonly verdict?: "pass" | "fail" | "n/a" }
  | { readonly kind: "sampled";   readonly verdict: "pass" | "fail" | "n/a"; readonly reasoning: string; readonly samplerId: string; readonly sampledAt: string };

interface CriterionEvidence {
  readonly criterionId: string;
  readonly standardId: string;
  readonly automatable: Automatability;
  readonly status: EvidenceStatus;
  readonly sources: readonly EvidenceSource[];
}

interface EvidenceLedger {
  readonly entries: readonly CriterionEvidence[];
  readonly meta: {
    readonly generatedAt: string;
    readonly enabledStandards: readonly string[];
  };
}
```

### Status derivation (Phase 1)

Applied per criterion in strict precedence:

| Condition | `status` |
|---|---|
| Any `static` source present | `fail` |
| `automatable !== "manual"` and no `static` source | `pass` |
| `automatable === "manual"` (any or no candidate sources) | `unknown` |

`n/a` is reserved. No producer in Phase 1 — becomes reachable when
attestations with a "not applicable" assertion land (Phase 2).

Later phases refine: an `attested` source with `verdict: "pass"` can
promote an `unknown` manual criterion to `pass` (and vice versa for
`"fail"` / `"n/a"`); a `sampled.verdict === "n/a"` promotes to `n/a`.
The derivation stays a pure function over `sources[]`; adding a
producer never forces an API change.

### Equivalence fan-out is free

`Violation.criteria` already contains every equivalent criterion ID
for enabled standards (via `StandardFilter.citedCriteria` →
`CriteriaRegistry.equivalenceClosure`). The ledger builder indexes
violations by each ID in `v.criteria`; one static finding against
`wcag22:1.4.3` contributes to `section508:1194.22.c`'s evidence
automatically. No new equivalence code.

### ScanProducts integration

`ledger: EvidenceLedger` becomes a sibling on `ScanProducts`,
following the pattern already in place for `perRuleCoverage` (ADR
0007's "keep it off `ScanResult` so fixtures don't churn"). No
existing consumer is required to read it; the field is additive.

```ts
export interface ScanProducts {
  readonly result: ScanResult;
  readonly report: ReportData;
  readonly perRuleCoverage: readonly PerRuleCoverage[];
  readonly ledger: EvidenceLedger; // new
}
```

### Phase boundaries

**Phase 1 — this ADR.** Shape + builder + ScanProducts integration
+ unit tests. Zero MCP shape changes. `static` and `candidate`
sources have producers; `attested` / `sampled` slots exist but
produce nothing yet.

**Phase 2 — attestations.** `ra11y-disable` pragmas with a captured
`reason` emit `attested` sources alongside the existing silence. A
new `attest` MCP tool writes durable entries to
`.ra11y/attestations.jsonl`. `C-ATTEST-*` items close here.

**Phase 3 — conformance statement.** The conformance-statement report
(`C-CONFORM-STATEMENT`) becomes implementable — refuses to emit
unless every criterion in the configured profile has at least one
non-`candidate` source and `status !== "unknown"`. Sampling verdicts
(`sampled` kind) become available once Track S's speculative
sampling tools ship.

Each phase is a ≤400-LOC net-diff commit set per CLAUDE.md § 9. The
shape in § "Shapes" above is the Phase 3 shape; Phase 1 ships it
whole so later phases never touch consumers.

## Consequences

- `src/types/evidence.ts` (new, ~80 LOC): the shapes above.
- `src/engine/evidence-ledger.ts` (new, ~120 LOC): the pure builder
  `(ScanResult, ReportData, StandardsRegistry, enabled) →
  EvidenceLedger`. Indexes violations by every ID in `v.criteria`
  (equivalence fan-out already expanded upstream), attaches
  candidates by `criterionId`, derives status.
- `src/engine/scanner.ts` grows one field on `ScanProducts`. No
  behaviour change in the scan pipeline.
- `tests/unit/engine/evidence-ledger.test.ts` (new, ~200 LOC): status
  derivation table, equivalence fan-out, manual-vs-automatable split,
  meta fields, determinism.
- Subsequent phases add to `EvidenceSource`'s union but the shape
  doesn't move; discriminated-union consumers (MCP payload assemblers,
  conformance report) stay forward-compatible.

No breaking changes. No churn to rule authors, formatter authors, or
MCP handlers in Phase 1.

## Amendment — 2026-04-18

Dropped the `"runtime"` source kind from the union before any
producer shipped. Vendor runtime scanners (axe-core, Lighthouse,
WAVE, Pa11y) each have vendor-specific JSON schemas and
vendor-specific rule-to-WCAG mappings; building an ingest adapter
for any of them commits ra11y to that vendor's continued existence
and shape. In the AI-first consumer model the agent is the
integration layer — it runs the runtime tool in its CI harness,
reads the output JSON with its existing tools, and calls `attest`
with a descriptive `by` + `reason`. The resulting `attested` source
carries full provenance without ra11y taking a vendor bet.

`attested` gained an optional `verdict: "pass" | "fail" | "n/a"`
field so an attestation can assert a failure state (e.g., "axe-core
reported two violations") rather than being implicitly pass-only.

See `feedback_no_vendor_ingest_adapters` in auto-memory for the
durable rule.

## Alternatives considered

1. **Reshape `Violation` into `EvidenceSource` directly.** Rejected:
   rule authors write `Violation`s; touching their surface is churn
   for no user benefit. Keep `Violation` as one producer of one source
   kind.
2. **Store the ledger on `ScanResult`.** Rejected: every fixture
   literal would need updating. The `perRuleCoverage` precedent
   (ADR 0007) keeps derived telemetry on `ScanProducts` instead, and
   the rationale — MCP layer is the sole consumer — applies
   identically here in Phase 1.
3. **Defer until Phase 2 needs it.** Rejected: attempting to retro-fit
   a shared primitive after three Track C items each land their own
   ad-hoc shape is strictly more expensive than paying the cost once
   up front. The empty `attested`/`runtime`/`sampled` slots cost
   nothing; they prevent parallel vocabularies from calcifying.
4. **Map-shaped `byCriterion: Record<id, entry>` in the public
   type.** Rejected for serialization ergonomics — `readonly entries:
   CriterionEvidence[]` sorted by criterion ID is unambiguous under
   JSON and stable across runs. Builder-internal lookup uses a Map.
