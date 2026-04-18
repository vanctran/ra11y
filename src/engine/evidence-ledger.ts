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

  const entries: CriterionEvidence[] = [];
  for (const standard of inputs.standards) {
    if (!inputs.enabled.has(standard.id)) continue;
    for (const criterion of standard.criteria) {
      const staticSources = staticByCriterion.get(criterion.id) ?? [];
      const candidateSources = candidateByCriterion.get(criterion.id) ?? [];
      const sources: EvidenceSource[] = [...staticSources, ...candidateSources];
      entries.push({
        criterionId: criterion.id,
        standardId: standard.id,
        automatable: criterion.automatable,
        status: deriveStatus(criterion.automatable, staticSources.length > 0),
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
 * Phase 1 status derivation. Strict precedence:
 *
 *   1. Any `static` source → `"fail"`.
 *   2. Automatable (non-manual) criterion, no static source → `"pass"`.
 *   3. Otherwise (manual, with or without candidates) → `"unknown"`.
 *
 * `"n/a"` is reserved for Phase 2+ attestations and has no Phase 1
 * producer.
 */
function deriveStatus(automatable: Automatability, hasStaticFailure: boolean): EvidenceStatus {
  if (hasStaticFailure) return "fail";
  if (automatable !== "manual") return "pass";
  return "unknown";
}
