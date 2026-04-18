/**
 * Types for the Evidence primitive — per-criterion aggregation of every
 * input that speaks to conformance for that criterion.
 *
 * An {@link EvidenceLedger} is a derived view over one scan plus, in
 * later phases, externally-supplied inputs (attestations, runtime
 * results, sampling verdicts). A rule produces `Violation`s; a finder
 * produces `ReviewCandidate`s; both become {@link EvidenceSource}s on
 * the ledger.
 *
 * The ledger is the substrate a conformance statement refuses or
 * emits from — in contrast to `Violation[]` alone, which cannot
 * distinguish "checked and clean" from "not checked."
 *
 * See docs/adr/0011-evidence-as-first-class-primitive.md.
 *
 * Phase 1 ships the full shape but only `static` and `candidate`
 * sources have producers. `attested` / `runtime` / `sampled` slots
 * exist so later phases add producers without changing the public
 * type.
 */

import type { ReviewConfidence } from "./review.ts";
import type { Automatability } from "./standard.ts";
import type { Location } from "./violation.ts";

/**
 * Derived verdict for a criterion. Applied per-criterion in strict
 * precedence; the derivation is a pure function over
 * {@link CriterionEvidence.sources}.
 *
 * - `"fail"` — at least one `static` source (a violation was emitted).
 *   Later phases promote `runtime.outcome === "fail"` and
 *   `sampled.verdict === "fail"` to this bucket too.
 * - `"pass"` — the criterion is automatable (not `"manual"`) and
 *   carries no `"fail"`-yielding source. Phase 1 bases this on the
 *   absence of `static` sources alone; later phases may additionally
 *   require positive runtime/attested evidence before promoting.
 * - `"unknown"` — the criterion is manual-only, or the ledger has
 *   no source that speaks to it. Candidate sources do not move a
 *   criterion out of `"unknown"` — they point reviewers at locations
 *   to inspect, they don't assert anything.
 * - `"n/a"` — the criterion does not apply (e.g., media-only criteria
 *   in a text-only app, declared via an attestation). Reserved for
 *   Phase 2+; no Phase 1 producer emits this.
 */
export type EvidenceStatus = "pass" | "fail" | "unknown" | "n/a";

/**
 * One input contributing to a criterion's verdict. Discriminated by
 * {@link EvidenceSource.kind} so consumers narrow via the discriminant
 * rather than optional-field archaeology.
 *
 * Phase 1 producers:
 *   - `static` — one per violation, for each criterion in
 *     {@link Violation.criteria} (equivalence fan-out is already
 *     applied upstream by the standard filter).
 *   - `candidate` — one per review candidate, keyed by
 *     `candidate.criterionId`.
 *
 * Phase 2+ producers have no implementation yet but their shapes are
 * locked in so future code never has to migrate the discriminant.
 *
 * A note on runtime evidence: there is deliberately no `"runtime"`
 * source kind. Vendor runtime scanners (axe-core, Lighthouse, WAVE,
 * Pa11y) produce JSON with vendor-specific schemas and vendor-specific
 * rule-to-WCAG mappings. In the AI-first consumer model the agent
 * reads that JSON with its existing tools and calls `attest` — the
 * resulting `attested` source carries the provenance in its `by` and
 * `reason` fields, without ra11y committing to any vendor's schema.
 * `sampled` is kept as its own kind because ra11y itself owns the
 * sampling-tool contract (Track S); `runtime` is not distinguishable
 * from `attested` in a way ra11y can defend without picking a vendor.
 */
export type EvidenceSource =
  | {
      readonly kind: "static";
      /** Stable identity of the underlying violation; look up via `ScanResult.violations`. */
      readonly findingId: string;
    }
  | {
      readonly kind: "candidate";
      readonly location: Location;
      readonly reason: string;
      readonly confidence: ReviewConfidence;
      /** ID of the finder that emitted the candidate, when known. */
      readonly finderId?: string;
    }
  | {
      readonly kind: "attested";
      /** Who attested (author identifier, bot ID, commit author, runtime-tool-plus-CI, …). */
      readonly by: string;
      /** Human-readable reason the author asserts the criterion is satisfied. */
      readonly reason: string;
      /** ISO-8601 timestamp the attestation was recorded. */
      readonly attestedAt: string;
      /** Attestation scope — defaults to `"project"` when omitted. */
      readonly scope?: "project" | "file" | "line";
      /** Location the attestation pins to, when `scope !== "project"`. */
      readonly location?: Location;
      /** Verdict the attestation asserts; defaults to `"pass"` when omitted. */
      readonly verdict?: "pass" | "fail" | "n/a";
    }
  | {
      readonly kind: "sampled";
      readonly verdict: "pass" | "fail" | "n/a";
      readonly reasoning: string;
      /** Identifier of the sampling tool / prompt that produced the verdict. */
      readonly samplerId: string;
      /** ISO-8601 timestamp the verdict was produced. */
      readonly sampledAt: string;
    };

/**
 * One criterion's full evidence pile plus its derived verdict.
 *
 * `status` is computed from `sources`; the builder is a pure function
 * and every source that contributed is listed. `sources` is sorted for
 * determinism — see the builder for the ordering rule.
 */
export interface CriterionEvidence {
  readonly criterionId: string;
  readonly standardId: string;
  readonly automatable: Automatability;
  readonly status: EvidenceStatus;
  readonly sources: readonly EvidenceSource[];
}

/**
 * A durable attestation record — either inline (emitted by a pragma
 * with a `reason=` text) or project-level (written to
 * `.ra11y/attestations.jsonl` by the `attest` MCP tool). Both feed the
 * same `attested` {@link EvidenceSource} kind on the ledger.
 *
 * A pragma without a reason does *not* produce an attestation — the
 * scanner still silences the matching violation, but no evidence lands
 * on the ledger. That's why `ra11y:suppression-no-reason` surfaces
 * bare pragmas as review candidates: the author punted the assertion.
 *
 * Validation is lenient: records whose `criterionId` is not present in
 * any enabled standard are skipped silently by the ledger builder —
 * mirroring the `equivalentTo` "silently skip missing" pattern so
 * standards can be toggled without throwing on stored attestations
 * about disabled criteria.
 */
export interface AttestationRecord {
  /** Criterion this attestation speaks to (`<standardId>:<localId>`). */
  readonly criterionId: string;
  /** Who attested — author, bot, runtime-tool-plus-CI, etc. */
  readonly by: string;
  /** Human-readable rationale. */
  readonly reason: string;
  /** ISO-8601 timestamp the attestation was recorded. */
  readonly attestedAt: string;
  /** Attestation scope; defaults to `"project"` when omitted. */
  readonly scope?: "project" | "file" | "line";
  /** Location the attestation pins to, when `scope !== "project"`. */
  readonly location?: Location;
  /** Verdict the attestation asserts; defaults to `"pass"` when omitted. */
  readonly verdict?: "pass" | "fail" | "n/a";
}

/**
 * A per-scan aggregate of every criterion in every enabled standard.
 *
 * `entries` is sorted by `criterionId` for determinism; consumers that
 * need fast random access can build their own Map.
 */
export interface EvidenceLedger {
  readonly entries: readonly CriterionEvidence[];
  readonly meta: {
    /** ISO-8601 timestamp the ledger was produced. */
    readonly generatedAt: string;
    /** Standards enabled for this ledger, sorted by id. */
    readonly enabledStandards: readonly string[];
  };
}
