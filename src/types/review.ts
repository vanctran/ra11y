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

import type { Ast } from "./ast.ts";
import type { AppliesTo, FileContext, RuleContext } from "./rule.ts";
import type { Location } from "./violation.ts";

/**
 * How strongly the finder's static evidence supports this being a real
 * review candidate. Same enum, same semantics as the `confidence` field
 * on automated findings (see `severityToConfidence` in
 * src/mcp/tools-helpers.ts) so an agent's threshold/filter logic reads
 * the same way across surfaces.
 *
 * - `"high"`: deterministic match. The scanner can name the exact static
 *   evidence (element tag, attribute combination, known library import,
 *   cross-file ordering divergence) and a reviewer's next read confirms
 *   or rejects the question the criterion asks. Near-zero false-positive
 *   floor.
 * - `"medium"`: concrete evidence exists but the question the finder
 *   surfaces depends on context the scanner can't see (e.g.
 *   "setTimeout" — real session timeout vs debounce). The candidate is
 *   always worth reading; the dismissal is often one file Read away.
 * - `"low"`: heuristic match on narrow evidence (text-regex, className
 *   convention, structural proxy for a page-set concern). The finder's
 *   docstring typically notes it is "biased toward false positives."
 *   Still surface — an agent dismisses in milliseconds — but threshold
 *   filtering here is meaningful for batch workflows.
 */
export type ReviewConfidence = "high" | "medium" | "low";

/** A location where a human reviewer should verify a manual criterion. */
export interface ReviewCandidate {
  /** The criterion this candidate is relevant to (e.g., "wcag22:1.2.1"). */
  readonly criterionId: string;
  /** Where in the source file the candidate was found. */
  readonly location: Location;
  /** Short explanation of why this location needs review. */
  readonly reason: string;
  /**
   * How strongly the finder's static evidence supports this candidate.
   * Required — every grounded candidate carries a confidence value.
   * Finders choose the value based on what their static signal can
   * actually claim; see {@link ReviewConfidence}.
   */
  readonly confidence: ReviewConfidence;
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
 * The minimal per-file record a project-scoped finder sees. This is the
 * already-parsed material the scanner collected on the per-file pass;
 * project finders MUST NOT re-parse.
 */
export interface ProjectFile {
  readonly filePath: string;
  readonly source: string;
  readonly ast: Ast;
  readonly disableMap: ReadonlyMap<number, ReadonlySet<string>>;
}

/**
 * Context passed to a candidate finder's `afterProject` hook. Carries
 * every parsed file the scanner touched plus the enabled-standards set,
 * so a cross-file finder (e.g. WCAG 3.2.3 Consistent Navigation) can
 * compare structures between routes without reopening files.
 */
export interface ProjectCandidateContext {
  readonly files: readonly ProjectFile[];
  readonly enabledStandards: ReadonlySet<string>;
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
  /**
   * Project-scoped finder — called once after every file has been
   * processed. Used for cross-file checks like WCAG 3.2.3 Consistent
   * Navigation, where a candidate only exists relative to other
   * files. The returned candidates' `location.filePath` MUST be one
   * of the paths in `ctx.files`; the scanner applies per-file
   * disableMap filtering before surfacing them.
   */
  afterProject?(ctx: ProjectCandidateContext): readonly ReviewCandidate[] | undefined;
}
