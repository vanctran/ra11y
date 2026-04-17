/**
 * Types for violations and scan results.
 *
 * A {@link Violation} is what a rule emits when it finds a problem. It cites
 * both the rule ID that produced it and the criteria (across every enabled
 * standard) that the violation maps to — so a single check can inform the
 * WCAG 2.2 report, the Section 508 report, and the EN 301 549 report from
 * the same run.
 *
 * See docs/kb/architecture/rule-engine.md.
 */

export type Severity = "error" | "warning" | "info";

/** A location in a source file. Byte-offset-agnostic; columns are 1-based. */
export interface Location {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

/** A structured edit that an auto-fixer can apply. */
export interface Fix {
  readonly type: "insert" | "replace" | "delete";
  readonly range: { readonly start: number; readonly end: number };
  readonly text: string;
  readonly description: string;
  readonly safety: "safe" | "unsafe";
}

/**
 * Ranked resolution paths for a violation, split into the most-likely
 * fix and lower-likelihood alternatives. Labels are human-readable
 * sentences the agent can act on ("widen aria-label to contain the
 * visible text…"). When a rule can also produce a mechanical edit it
 * may populate `edit` on a path; absent `edit`, the path is guidance
 * only (still more useful than an empty oldText/newText pair).
 */
export interface FixPath {
  readonly label: string;
  readonly edit?: {
    readonly oldText: string;
    readonly newText: string;
  };
}

export interface FixPaths {
  readonly primary: FixPath;
  readonly alternatives: readonly FixPath[];
}

/** A single accessibility finding emitted by a rule. */
export interface Violation {
  readonly ruleId: string;
  /** Criterion IDs this violation counts against, filtered to enabled standards. */
  readonly criteria: readonly string[];
  readonly severity: Severity;
  readonly location: Location;
  readonly message: string;
  readonly suggestion?: string;
  readonly fix?: Fix;
  readonly fixPaths?: FixPaths;
  readonly snippet?: string;
  /**
   * Stable identity for the finding — the same opaque token across
   * re-runs of the same scan, so an agent can verify "did my edit
   * close finding X?" by exact identity rather than fuzzy `(file,
   * line, ruleId)` matching. Survives line-number drift inside the
   * file when unrelated code is inserted above the violation.
   *
   * Computed as `sha256(ruleId, relativeFilePath, lineContextHash)`
   * truncated to 12 hex chars. See `src/utils/finding-id.ts` for the
   * exact recipe. Required on every Violation — if a call site needs
   * to synthesize one, use `computeFindingId`.
   */
  readonly findingId: string;
}

/** Aggregate result of a full scan. */
export interface ScanResult {
  readonly violations: readonly Violation[];
  readonly filesScanned: number;
  readonly durationMs: number;
  readonly enabledStandards: readonly string[];
  readonly isTTY: boolean;
}

/** Structured data produced from a ScanResult, consumed by formatters and reports. */
export interface ReportData {
  readonly coverage: readonly CoverageEntry[];
  readonly manualReviewNeeded: readonly string[];
  /** Review candidates grouped by criterion ID (populated when finders are run). */
  readonly candidates?: readonly import("./review.ts").ReviewCandidate[];
}

export interface CoverageEntry {
  readonly standardId: string;
  readonly automated: number;
  readonly total: number;
  readonly passing: number;
  readonly failing: number;
}
