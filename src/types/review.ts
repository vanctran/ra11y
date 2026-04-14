/**
 * Types for the assisted manual review system.
 *
 * A {@link ReviewCandidate} is a location in source code where a human
 * reviewer should look for a specific accessibility criterion. Unlike a
 * {@link Violation}, it makes no pass/fail claim — the scanner found the
 * needle, the reviewer makes the call.
 *
 * A {@link CandidateFinder} is the structural analog of a {@link Rule}
 * for the review system: a pure function that walks ASTs and emits
 * candidates. Finders declare which criterion IDs they surface
 * candidates for via `criterionIds`.
 *
 * See docs/architecture.md for context on how this fits the three-layer model.
 */

import type { AppliesTo, FileContext, RuleContext } from "./rule.ts";
import type { Location } from "./violation.ts";

/** A location where a human reviewer should verify a manual criterion. */
export interface ReviewCandidate {
  /** The criterion this candidate is relevant to (e.g., "wcag22:1.2.1"). */
  readonly criterionId: string;
  /** Where in the source file the candidate was found. */
  readonly location: Location;
  /** Short explanation of why this location needs review. */
  readonly reason: string;
  /** Optional source snippet for context in reports. */
  readonly snippet?: string;
}

/** Scope for a candidate finder — same semantics as RuleScope minus "project". */
export type CandidateFinderScope = "node" | "document";

/** Documentation for a candidate finder. */
export interface CandidateFinderDocs {
  /** One-line description of what the finder looks for. */
  readonly description: string;
  /** What the human reviewer should check at each candidate location. */
  readonly reviewPrompt: string;
  /** Spec URLs and references. */
  readonly references: readonly string[];
}

/**
 * A candidate finder — finds locations that need human review for
 * manual accessibility criteria. Structurally parallel to Rule but
 * emits ReviewCandidate[] instead of Violation[].
 */
export interface CandidateFinder {
  /** Unique identifier (e.g., "review/media-alternatives"). */
  readonly id: string;
  /** Criterion IDs this finder surfaces candidates for. */
  readonly criterionIds: readonly string[];
  readonly scope: CandidateFinderScope;
  readonly appliesTo?: AppliesTo;
  readonly docs: CandidateFinderDocs;
  /**
   * When true, the engine keeps at most one emitted candidate per
   * criterion across all files. Used for page-set-level checks whose
   * question ("does the site offer multiple ways to navigate?") is
   * shared by every plausible root layout — otherwise the reviewer
   * sees the same prompt once per root file.
   */
  readonly uniquePerCriterion?: boolean;
  /** Node-scoped finder — called once per file, finder iterates internally. */
  find?(ctx: RuleContext): readonly ReviewCandidate[] | undefined;
  /** Document-scoped finder — called after file parsing. */
  afterFile?(ctx: FileContext): readonly ReviewCandidate[] | undefined;
}
