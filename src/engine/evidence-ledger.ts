/**
 * Pure builder for the {@link EvidenceLedger}.
 *
 * Consumes the scanner's outputs (violations + review candidates) plus
 * the enabled-standards set and returns a per-criterion evidence
 * aggregate. The ledger is the substrate for Phase 2 attestations,
 * Phase 3 runtime ingest + sampling verdicts, and the eventual
 * conformance-statement emitter.
 *
 * See docs/adr/0011-evidence-as-first-class-primitive.md.
 *
 * Equivalence fan-out is already applied upstream:
 * `Violation.criteria` contains every equivalent criterion ID for the
 * enabled standards (see `standard-filter.ts` →
 * `CriteriaRegistry.equivalenceClosure`). This builder indexes by
 * `v.criteria` directly, so one static finding against `wcag22:1.4.3`
 * contributes to `section508:1194.22.c`'s evidence without any extra
 * lookup.
 */

import type {
  AttestationRecord,
  CriterionEvidence,
  EvidenceLedger,
  EvidenceSource,
  EvidenceStatus,
} from "../types/evidence.ts";
import type { ReviewCandidate } from "../types/review.ts";
import type { Automatability, Standard } from "../types/standard.ts";
import type { ReportData, ScanResult, Violation } from "../types/violation.ts";

export interface BuildEvidenceLedgerInputs {
  readonly result: ScanResult;
  readonly report: ReportData;
  /**
   * The same standards that were passed to `runScan`. The builder only
   * emits entries for criteria under `enabled` standards; criteria in
   * loaded-but-disabled standards are skipped.
   */
  readonly standards: readonly Standard[];
  readonly enabled: ReadonlySet<string>;
  /**
   * Attestation records from inline pragmas and the durable
   * `.ra11y/attestations.jsonl` store. Records whose `criterionId` is
   * not in an enabled standard are silently skipped — standards can
   * toggle on and off without throwing on stored attestations for
   * disabled ones. Default empty.
   */
  readonly attestations?: readonly AttestationRecord[];
  /**
   * Returns the set of rule IDs that satisfy the given criterion. Used
   * by the partial-coverage check in status derivation (ADR 0013): an
   * attestation with explicit `ruleIds` only clears the criterion when
   * the union of all attested `ruleIds` covers this rule set. Default
   * returns an empty array — safe for tests that don't exercise the
   * coverage path, but scanner wiring should pass
   * `(id) => rulesRegistry.rulesFor(id)` so production derivation uses
   * real rule sets.
   */
  readonly rulesForCriterion?: (criterionId: string) => readonly string[];
  /**
   * ISO-8601 stamp for {@link EvidenceLedger.meta.generatedAt}. Default
   * `new Date().toISOString()`. Overridable so tests can pin the value
   * for deterministic assertions.
   */
  readonly generatedAt?: string;
}

/**
 * Builds an {@link EvidenceLedger} from one scan's outputs. Pure —
 * given the same inputs (same timestamp), produces byte-for-byte the
 * same ledger.
 */
export function buildEvidenceLedger(inputs: BuildEvidenceLedgerInputs): EvidenceLedger {
  const staticByCriterion = indexStaticSources(inputs.result.violations);
  const candidateByCriterion = indexCandidateSources(inputs.report.candidates ?? []);
  const attestedByCriterion = indexAttestedSources(inputs.attestations ?? []);
  const rulesForCriterion = inputs.rulesForCriterion ?? (() => []);

  const entries: CriterionEvidence[] = [];
  for (const standard of inputs.standards) {
    if (!inputs.enabled.has(standard.id)) continue;
    for (const criterion of standard.criteria) {
      const staticSources = staticByCriterion.get(criterion.id) ?? [];
      const candidateSources = candidateByCriterion.get(criterion.id) ?? [];
      const attestedSources = attestedByCriterion.get(criterion.id) ?? [];
      const sources: EvidenceSource[] = [...staticSources, ...attestedSources, ...candidateSources];
      entries.push({
        criterionId: criterion.id,
        standardId: standard.id,
        automatable: criterion.automatable,
        status: deriveStatus(
          criterion.automatable,
          staticSources,
          attestedSources,
          rulesForCriterion(criterion.id),
        ),
        sources,
      });
    }
  }

  entries.sort((a, b) =>
    a.criterionId < b.criterionId ? -1 : a.criterionId > b.criterionId ? 1 : 0,
  );

  return {
    entries,
    meta: {
      generatedAt: inputs.generatedAt ?? new Date().toISOString(),
      enabledStandards: [...inputs.enabled].sort(),
    },
  };
}

/**
 * Indexes `static` sources by criterion ID. One violation fans out to
 * every ID in its `criteria[]` — equivalence closure is already
 * expanded upstream. Within a criterion the static list is sorted by
 * `findingId` for determinism.
 */
function indexStaticSources(violations: readonly Violation[]): Map<string, EvidenceSource[]> {
  const byCriterion = new Map<string, EvidenceSource[]>();
  for (const v of violations) {
    for (const id of v.criteria) {
      let list = byCriterion.get(id);
      if (!list) {
        list = [];
        byCriterion.set(id, list);
      }
      list.push({ kind: "static", findingId: v.findingId });
    }
  }
  for (const list of byCriterion.values()) {
    list.sort((a, b) => {
      // a,b are static-kind; discriminant narrows findingId access.
      const aId = a.kind === "static" ? a.findingId : "";
      const bId = b.kind === "static" ? b.findingId : "";
      return aId < bId ? -1 : aId > bId ? 1 : 0;
    });
  }
  return byCriterion;
}

/**
 * Indexes `candidate` sources by criterion ID. Candidates are already
 * sorted by (filePath, line, criterionId) when the scanner produces
 * them; this preserves that order.
 */
function indexCandidateSources(
  candidates: readonly ReviewCandidate[],
): Map<string, EvidenceSource[]> {
  const byCriterion = new Map<string, EvidenceSource[]>();
  for (const c of candidates) {
    let list = byCriterion.get(c.criterionId);
    if (!list) {
      list = [];
      byCriterion.set(c.criterionId, list);
    }
    list.push({
      kind: "candidate",
      location: c.location,
      reason: c.reason,
      confidence: c.confidence,
    });
  }
  return byCriterion;
}

/**
 * Indexes `attested` sources by criterion ID. Attestation records are
 * sorted per-criterion by `attestedAt` (ascending) for determinism;
 * ties break on `by` then `reason`.
 */
function indexAttestedSources(
  attestations: readonly AttestationRecord[],
): Map<string, EvidenceSource[]> {
  const byCriterion = new Map<string, EvidenceSource[]>();
  for (const a of attestations) {
    let list = byCriterion.get(a.criterionId);
    if (!list) {
      list = [];
      byCriterion.set(a.criterionId, list);
    }
    list.push({
      kind: "attested",
      by: a.by,
      reason: a.reason,
      attestedAt: a.attestedAt,
      ...(a.ruleIds !== undefined && { ruleIds: a.ruleIds }),
      ...(a.scope !== undefined && { scope: a.scope }),
      ...(a.location !== undefined && { location: a.location }),
      ...(a.verdict !== undefined && { verdict: a.verdict }),
    });
  }
  for (const list of byCriterion.values()) list.sort(compareAttestedSources);
  return byCriterion;
}

function compareAttestedSources(a: EvidenceSource, b: EvidenceSource): number {
  if (a.kind !== "attested" || b.kind !== "attested") return 0;
  if (a.attestedAt !== b.attestedAt) return a.attestedAt < b.attestedAt ? -1 : 1;
  if (a.by !== b.by) return a.by < b.by ? -1 : 1;
  if (a.reason < b.reason) return -1;
  if (a.reason > b.reason) return 1;
  return 0;
}

/**
 * Phase 2 status derivation with ADR-0013 coverage check. Strict
 * precedence:
 *
 *   1. Any `static` source OR any attested `"fail"` → `"fail"`. Static
 *      findings are in-tree evidence; they win over any claim to the
 *      contrary. A fail-attestation with no static finding still
 *      produces fail (author asserted a runtime failure the scanner
 *      couldn't see).
 *   2. Any attested `"n/a"` and no fail-evidence → `"n/a"`.
 *   3. Any attested `"pass"`, and either:
 *        - `rulesForCriterion` is empty (purely manual — vacuous
 *          coverage), OR
 *        - at least one attestation omits `ruleIds` (criterion-wide
 *          claim covers every satisfying rule), OR
 *        - the union of `ruleIds` across pass-attestations ⊇
 *          `rulesForCriterion`
 *      → `"pass"`.
 *   4. Any attested `"pass"` but the rule-coverage union is a proper
 *      subset of `rulesForCriterion` → `"partial"`. Some slice was
 *      verified; others remain unattested.
 *   5. Automatable (non-manual) criterion with no fail-evidence and no
 *      attestations → `"pass"` (absence of failure; the conformance
 *      report promotes this to a `"no-evidence"` blocker when an
 *      explicit attestation is required).
 *   6. Otherwise (manual, with only candidate sources or none) →
 *      `"unknown"`.
 *
 * Candidate sources never move a criterion's status — they point a
 * reviewer at locations but don't assert.
 */
function deriveStatus(
  automatable: Automatability,
  staticSources: readonly EvidenceSource[],
  attestedSources: readonly EvidenceSource[],
  rulesForCriterion: readonly string[],
): EvidenceStatus {
  const tally = tallyAttestations(attestedSources);
  if (staticSources.length > 0 || tally.hasFail) return "fail";
  if (tally.hasNA) return "n/a";
  if (tally.hasPass) return derivePassStatus(tally, rulesForCriterion);
  if (automatable !== "manual") return "pass";
  return "unknown";
}

interface AttestationTally {
  hasFail: boolean;
  hasNA: boolean;
  hasPass: boolean;
  hasUniversalPass: boolean;
  readonly passRules: Set<string>;
}

function tallyAttestations(sources: readonly EvidenceSource[]): AttestationTally {
  const tally: AttestationTally = {
    hasFail: false,
    hasNA: false,
    hasPass: false,
    hasUniversalPass: false,
    passRules: new Set(),
  };
  for (const s of sources) {
    if (s.kind === "attested") absorbAttestation(tally, s);
  }
  return tally;
}

function absorbAttestation(
  tally: AttestationTally,
  source: Extract<EvidenceSource, { kind: "attested" }>,
): void {
  const verdict = source.verdict ?? "pass";
  if (verdict === "fail") {
    tally.hasFail = true;
    return;
  }
  if (verdict === "n/a") {
    tally.hasNA = true;
    return;
  }
  // `pending` is an unasserted claim (bare source-pragma awaiting a
  // reason). It surfaces in `list_attestations` so agents can act on
  // the gap, but it contributes neither pass nor fail to status —
  // the author has not yet attested anything.
  if (verdict === "pending") return;
  tally.hasPass = true;
  if (source.ruleIds === undefined) tally.hasUniversalPass = true;
  else for (const r of source.ruleIds) tally.passRules.add(r);
}

function derivePassStatus(
  tally: AttestationTally,
  rulesForCriterion: readonly string[],
): EvidenceStatus {
  if (rulesForCriterion.length === 0) return "pass";
  if (tally.hasUniversalPass) return "pass";
  for (const r of rulesForCriterion) if (!tally.passRules.has(r)) return "partial";
  return "pass";
}
