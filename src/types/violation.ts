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
 *
 * `editCandidate` is the softer sibling of `edit`: a synthesized
 * rewrite the rule would write "if it had to" — same shape as `edit`,
 * but the caller still has to decide whether the text is right. The
 * response `kind` remains `"guidance"` when only `editCandidate` is
 * populated (see `buildSuggestFixPayload`) — promotion to `kind: "edit"`
 * is reserved for deterministic rewrites. Use this for cases where a
 * templated rewrite is useful as a starting point but the choice of
 * phrasing is genuinely the author's call (e.g. `label-in-name` when
 * visible-text tokens are non-contiguous in aria-label).
 *
 * Per CLAUDE.md §1 "Ambiguous field shapes are dishonest": omit
 * `editCandidate` entirely when no candidate can be synthesized; never
 * emit `editCandidate: { oldText: "", newText: "" }`.
 */
export interface FixPath {
  readonly label: string;
  readonly edit?: {
    readonly oldText: string;
    readonly newText: string;
  };
  readonly editCandidate?: {
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
  /**
   * Remediation lane this finding routes into, stamped from the rule's
   * `fixClass` metadata at emit time. Values: `"mechanical"`,
   * `"guidance"`, `"runtime-only"`, `"verify-in-source"`. See
   * {@link import("./rule.ts").FixClass} and docs/adr/0007-violation-fix-class-metadata.md.
   *
   * Inlined on every violation so agents can batch-route findings at
   * scan time without a per-finding `suggest_fix` round-trip. Distinct
   * from `suggest_fix`'s response-level `kind: "edit" | "guidance"` —
   * that describes what the suggest_fix payload *contains*; `fixClass`
   * describes the *nature* of the fix the rule demands.
   */
  readonly fixClass: import("./rule.ts").FixClass;
  /** Criterion IDs this violation counts against, filtered to enabled standards. */
  readonly criteria: readonly string[];
  /**
   * Short human titles for {@link Violation.criteria}, aligned index-for-index:
   * `criteriaTitles[i]` is the title of `criteria[i]`. Lets consumers compose
   * PR bodies, commit messages, and human-readable reports without a second
   * `explain_rule` / `explain_standard` round-trip.
   *
   * When the criterion ID cannot be resolved against any loaded standard
   * (should not happen in practice — belt-and-braces), the criterion ID
   * itself is emitted as its own title rather than an empty string. Per
   * CLAUDE.md §1 "Ambiguous field shapes are dishonest," empty placeholders
   * are a silent-miss hazard; the ID as a fallback is deterministic and
   * always non-empty.
   *
   * Optional so that callers building synthetic Violations (e.g. crash
   * records with `criteria: []`) don't have to populate a parallel empty
   * array, but the engine stamps it on every emitted finding.
   */
  readonly criteriaTitles?: readonly string[];
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
  /**
   * Stable grouping key for findings that share a rule and an AST
   * shape. Sibling of `findingId` with opposite polarity: `findingId`
   * identifies *one finding* across runs, `groupKey` identifies *one
   * kind of problem* across findings. Same rule firing on
   * AST-equivalent `<img>` elements in 40 files → same `groupKey`.
   *
   * Lets agents write "fix every finding with groupKey X the same
   * way" scripts without re-deriving the pattern from rule ID +
   * filename + line number.
   *
   * Computed as `sha256(ruleId + "\0" + normalizedShape)` truncated to
   * `GROUP_KEY_HEX_LENGTH` hex chars. See `src/utils/group-key.ts`
   * and `describeNodeShape` in `src/engine/ast-helpers.ts` for the
   * exact recipe. Required on every Violation — if a call site needs
   * to synthesize one (synthetic crash records, test helpers), use
   * `computeGroupKey` with `UNKNOWN_SHAPE`.
   *
   * See docs/adr/0008-violation-group-key.md.
   */
  readonly groupKey: string;
  /**
   * Structured reason codes naming known escape hatches that could
   * make this finding a false positive in context. Each entry is a
   * stable snake_case identifier (`replacement_indicator_in_sibling_file`,
   * `tailwind_class_on_consumer`, …) pointing at a specific pattern an
   * agent can investigate with one `Read` or `Grep`.
   *
   * Strictly **informational**. Per the AI-first consumer doctrine
   * (docs/kb/architecture/ai-first-consumer.md §"No heuristic
   * suppression"), the scanner does NOT auto-suppress, downgrade, or
   * bucket findings based on the presence of codes — the agent reads
   * the cited file and decides. The scanner's attribute-level evidence
   * is categorically weaker than the agent's file-level evidence.
   *
   * Rules that know their own false-positive axes populate this field
   * at `ctx.emit()` time. Rules with no known escape hatches omit the
   * field. Optional: present-when-meaningful. Forwarders MUST NOT emit
   * `couldBeWrongBecause: []` (CLAUDE.md §1 "Ambiguous field shapes
   * are dishonest") — use a conditional spread:
   *
   * ```ts
   * ...(v.couldBeWrongBecause && v.couldBeWrongBecause.length > 0
   *   ? { couldBeWrongBecause: v.couldBeWrongBecause }
   *   : {})
   * ```
   *
   * See docs/adr/0009-violation-could-be-wrong-because.md.
   */
  readonly couldBeWrongBecause?: readonly string[];
}

/**
 * Per-rule coverage confidence for a single scan. Answers "this rule
 * produced 0 findings — should I trust that?" for rules whose
 * `appliesTo.fileExtensions` could mean the scan never saw a matching
 * source file. The canonical acute case: `contrast/minimum` targets
 * `.css`, and a Tailwind project pre-build has 0 eligible CSS sources
 * — a clean tally means nothing.
 *
 * Semantics:
 *   - `filesEligible` — parseable files whose extension matches the
 *     rule's `appliesTo.fileExtensions`. For rules without an extension
 *     gate, every scanned file is eligible.
 *   - `filesEvaluated` — subset of eligible files the rule actually
 *     ran over (non-eligible files are filtered out before invocation;
 *     evaluated <= eligible by construction).
 *   - `coverageConfidence` — `"low"` when `filesEligible === 0` or the
 *     rule ran on fewer than `MIN_FILES_FOR_HIGH_CONFIDENCE` files;
 *     `"high"` otherwise.
 *   - `reason` / `remediation` — populated only on low-confidence
 *     entries, per CLAUDE.md §1 "Ambiguous field shapes are dishonest"
 *     (conditional spread at the response-assembly site).
 *
 * Rules with `scope: "project"` and no `appliesTo.fileExtensions` (e.g.
 * `focus/outline-visible`) are not tracked — the concept doesn't apply.
 *
 * Produced by the scanner as a sibling field on
 * {@link import("../engine/scanner.ts").ScanProducts} — not on
 * {@link ScanResult}, because the MCP response layer is the sole
 * consumer. Keeping it off the shared result type avoids churning every
 * fixture that constructs a `ScanResult` literal when the shape evolves.
 *
 * See also: the top-level `ruleCoverage` derivative on scan responses
 * (`confidentlyClean` vs `lowConfidenceClean`) assembled by the MCP
 * layer from this array.
 */
export interface PerRuleCoverage {
  readonly ruleId: string;
  readonly filesEvaluated: number;
  readonly filesEligible: number;
  readonly coverageConfidence: "high" | "low";
  readonly reason?: string;
  readonly remediation?: string;
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
